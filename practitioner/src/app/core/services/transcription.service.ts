import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Auth } from './auth';

interface SessionState {
  ws: WebSocket | null;
  audioContext: AudioContext;
  sourceNode: MediaStreamAudioSourceNode | null;
  workletNode: AudioWorkletNode | null;
  /** Track transcribed — it belongs to the call, so it is never stopped here. */
  track: MediaStreamTrack;
  /** Set on stop, so that late callbacks neither report errors nor touch a successor. */
  stopped: boolean;
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

  /**
   * Start transcription for the local microphone, from the track published in the
   * call so that it follows the device selected there. A no-op when that very
   * track is already transcribed: the call re-emits its state on unrelated changes.
   */
  async start(appointmentId: number, language: string, track: MediaStreamTrack): Promise<void> {
    if (this.sessions.get(LOCAL_KEY)?.track === track) return;
    this.stopSession(LOCAL_KEY);
    this.isConnecting$.next(true);
    this.error$.next('');

    try {
      await this.createSession(LOCAL_KEY, track, appointmentId, language, null);
      this.isConnected$.next(this.sessions.has(LOCAL_KEY));
    } catch (err) {
      this.error$.next('Failed to start transcription');
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
    await this.createSession(identity, mediaStreamTrack, appointmentId, language, speakerLabel);
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
    track: MediaStreamTrack,
    appointmentId: number,
    language: string,
    speakerLabel: string | null
  ): Promise<void> {
    // Create & resume the AudioContext right away — still inside the user-gesture
    // Promise chain when started by the CC button click. Browsers suspend contexts
    // created later in async WS callbacks. The session is registered before the
    // first await, so that a concurrent start or stop finds it.
    const audioContext = new AudioContext();
    const session: SessionState = {
      ws: null,
      audioContext,
      sourceNode: null,
      workletNode: null,
      track,
      stopped: false,
    };
    this.sessions.set(key, session);

    await audioContext.resume().catch(err => {
      if (session.stopped) return;
      this.stopSession(key, session);
      throw err;
    });
    if (session.stopped) return;

    const token = this.auth.getToken();
    const wsUrl = `${environment.wsUrl}/appointment/${appointmentId}/transcription/?token=${token}`;

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
              this.stopSession(key, session);
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
          if (session.stopped) {
            resolve();
            return;
          }

          const sourceNode = audioContext.createMediaStreamSource(new MediaStream([track]));
          session.sourceNode = sourceNode;

          const workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
          session.workletNode = workletNode;

          workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const resampled = this.downsample(event.data, audioContext.sampleRate, this.targetSampleRate);
            ws.send(resampled.buffer);
          };

          sourceNode.connect(workletNode);
          // Route through a silent gain to keep the graph active without playing
          // back audio that the call already handles (our own microphone included).
          const silentGain = audioContext.createGain();
          silentGain.gain.value = 0;
          workletNode.connect(silentGain);
          silentGain.connect(audioContext.destination);

          resolve();
        } catch (err) {
          if (session.stopped) {
            resolve();
            return;
          }
          if (key === LOCAL_KEY) {
            this.error$.next('Failed to set up audio capture');
          }
          this.stopSession(key, session);
          reject(err);
        }
      };

      ws.onerror = () => {
        // Closing a socket that is still connecting fires an error too
        if (session.stopped) {
          resolve();
          return;
        }
        const msg = 'Connection to transcription server failed';
        if (key === LOCAL_KEY) {
          this.error$.next(msg);
          this.isConnected$.next(false);
        }
        this.stopSession(key, session);
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

  /** Stop the session under `key` — only if it still is `expected`, when given. */
  private stopSession(key: string, expected?: SessionState): void {
    const session = this.sessions.get(key);
    if (!session || (expected && session !== expected)) return;
    session.stopped = true;

    if (session.workletNode) {
      session.workletNode.port.onmessage = null;
      session.workletNode.disconnect();
    }
    if (session.sourceNode) {
      session.sourceNode.disconnect();
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