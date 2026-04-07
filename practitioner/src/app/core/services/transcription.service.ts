import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Auth } from './auth';

interface SessionState {
  ws: WebSocket | null;
  audioContext: AudioContext;
  sourceNode: MediaStreamAudioSourceNode | null;
  workletNode: AudioWorkletNode | null;
  /** Non-null only for the local mic session — tracks must be stopped on cleanup. */
  ownedStream: MediaStream | null;
}

const LOCAL_KEY = '__local__';

@Injectable({
  providedIn: 'root',
})
export class TranscriptionService implements OnDestroy {
  private sessions = new Map<string, SessionState>();
  private readonly targetSampleRate = 16000;

  readonly isConnected$ = new BehaviorSubject<boolean>(false);
  readonly isConnecting$ = new BehaviorSubject<boolean>(false);
  readonly error$ = new BehaviorSubject<string>('');

  constructor(private auth: Auth) {}

  /** Start transcription for the local microphone. */
  async start(appointmentId: number, language = 'en'): Promise<void> {
    this.stopSession(LOCAL_KEY);
    this.isConnecting$.next(true);
    this.error$.next('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

      // Create & resume AudioContext here — still inside the user-gesture Promise chain
      // (started by the CC button click).  Browsers suspend contexts created later in
      // async WS callbacks.
      const audioContext = new AudioContext();
      await audioContext.resume();

      await this.createSession(LOCAL_KEY, audioContext, stream, true, appointmentId, language, null);
      this.isConnected$.next(true);
    } catch (err) {
      this.error$.next('Failed to access microphone');
      this.isConnecting$.next(false);
      throw err;
    } finally {
      this.isConnecting$.next(false);
    }
  }

  /**
   * Start transcription for a remote participant's audio track.
   * The MediaStreamTrack comes from LiveKit — no getUserMedia needed.
   */
  async startRemote(
    identity: string,
    mediaStreamTrack: MediaStreamTrack,
    appointmentId: number,
    language: string,
    speakerLabel: string
  ): Promise<void> {
    this.stopSession(identity);
    const stream = new MediaStream([mediaStreamTrack]);

    // Create & resume AudioContext early — same user-gesture chain as start().
    const audioContext = new AudioContext();
    await audioContext.resume();

    await this.createSession(identity, audioContext, stream, false, appointmentId, language, speakerLabel);
  }

  /** Stop transcription for a specific remote participant. */
  stopRemote(identity: string): void {
    this.stopSession(identity);
  }

  /** Stop only the local microphone session, leaving remote sessions intact. */
  stopLocal(): void {
    this.stopSession(LOCAL_KEY);
    this.isConnected$.next(false);
    this.isConnecting$.next(false);
  }

  private async createSession(
    key: string,
    audioContext: AudioContext,
    stream: MediaStream,
    ownsTracks: boolean,
    appointmentId: number,
    language: string,
    speakerLabel: string | null
  ): Promise<void> {
    const token = this.auth.getToken();
    const wsUrl = `${environment.wsUrl}/appointment/${appointmentId}/transcription/?token=${token}`;

    const session: SessionState = {
      ws: null,
      audioContext,
      sourceNode: null,
      workletNode: null,
      ownedStream: ownsTracks ? stream : null,
    };
    this.sessions.set(key, session);

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      session.ws = ws;

      ws.onmessage = (event: MessageEvent) => {
        if (typeof event.data === 'string') {
          try {
            const data = JSON.parse(event.data);
            if (data.event === 'transcription_error') {
              const errorMsg = data.message || 'Transcription server unavailable';
              if (key === LOCAL_KEY) {
                this.error$.next(errorMsg);
                this.isConnected$.next(false);
              }
              this.stopSession(key);
            }
          } catch {
            // ignore non-JSON messages
          }
        }
      };

      ws.onopen = async () => {
        const msg: Record<string, unknown> = { type: 'start_transcription', language };
        if (speakerLabel) {
          msg['speaker_label'] = speakerLabel;
        }
        ws.send(JSON.stringify(msg));

        try {
          // AudioWorklet module — safe to load now that the context is running.
          await audioContext.audioWorklet.addModule('/audio-processor.js');

          const sourceNode = audioContext.createMediaStreamSource(stream);
          session.sourceNode = sourceNode;

          const workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
          session.workletNode = workletNode;

          workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const resampled = this.downsample(event.data, audioContext.sampleRate, this.targetSampleRate);
            ws.send(resampled.buffer);
          };

          sourceNode.connect(workletNode);
          if (ownsTracks) {
            // Local mic: connect to destination (keeps context alive, standard path).
            workletNode.connect(audioContext.destination);
          } else {
            // Remote track: route through a silent gain to keep the graph active
            // without double-playing audio that LiveKit already routes to speakers.
            const silentGain = audioContext.createGain();
            silentGain.gain.value = 0;
            workletNode.connect(silentGain);
            silentGain.connect(audioContext.destination);
          }

          resolve();
        } catch (err) {
          if (key === LOCAL_KEY) {
            this.error$.next('Failed to set up audio capture');
          }
          this.stopSession(key);
          reject(err);
        }
      };

      ws.onerror = () => {
        const msg = 'Connection to transcription server failed';
        if (key === LOCAL_KEY) {
          this.error$.next(msg);
          this.isConnected$.next(false);
        }
        this.stopSession(key);
        reject(new Error(msg));
      };

      ws.onclose = () => {
        if (key === LOCAL_KEY) {
          this.isConnected$.next(false);
          this.isConnecting$.next(false);
        }
      };
    });
  }

  private stopSession(key: string): void {
    const session = this.sessions.get(key);
    if (!session) return;

    if (session.workletNode) {
      session.workletNode.port.onmessage = null;
      session.workletNode.disconnect();
    }
    if (session.sourceNode) {
      session.sourceNode.disconnect();
    }
    if (session.ownedStream) {
      session.ownedStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
    }
    try {
      session.audioContext.close();
    } catch {
      // already closed
    }
    if (session.ws) {
      try {
        session.ws.send(JSON.stringify({ type: 'stop_transcription' }));
      } catch {
        // ws may already be closing
      }
      session.ws.close();
    }

    this.sessions.delete(key);
  }

  /** Stop all sessions (local + all remote). */
  stop(): void {
    for (const key of Array.from(this.sessions.keys())) {
      this.stopSession(key);
    }
    this.isConnected$.next(false);
    this.isConnecting$.next(false);
  }

  private downsample(buffer: Float32Array, fromSampleRate: number, toSampleRate: number): Float32Array {
    if (fromSampleRate === toSampleRate) return buffer;
    const ratio = fromSampleRate / toSampleRate;
    const length = Math.floor(buffer.length / ratio);
    const result = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      result[i] = buffer[Math.floor(i * ratio)];
    }
    return result;
  }

  ngOnDestroy(): void {
    this.stop();
  }
}