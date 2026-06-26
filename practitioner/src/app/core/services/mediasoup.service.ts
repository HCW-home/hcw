import { BehaviorSubject, Observable, Subject } from 'rxjs';

import type { types as MediasoupTypes } from 'mediasoup-client';
type Device = MediasoupTypes.Device;
type Transport = MediasoupTypes.Transport;
type Producer = MediasoupTypes.Producer;
type Consumer = MediasoupTypes.Consumer;
type RtpCapabilities = MediasoupTypes.RtpCapabilities;
type RtpParameters = MediasoupTypes.RtpParameters;
type DtlsParameters = MediasoupTypes.DtlsParameters;
type IceParameters = MediasoupTypes.IceParameters;
type IceCandidate = MediasoupTypes.IceCandidate;
import type { Socket } from 'socket.io-client';

import {
  ConnectionStatus,
  ParticipantInfo,
  VideoCallConfig,
  VideoCallDeviceIds,
  VideoCallImpl,
} from './video-call.types';

const EMPTY_PARTICIPANTS = new Map<string, ParticipantInfo>();
const REQUEST_TIMEOUT_MS = 20000;

interface NewConsumerPayload {
  peerId: string;
  producerId: string;
  id: string;
  kind: 'audio' | 'video';
  rtpParameters: unknown;
  appData?: Record<string, unknown>;
  producerPaused?: boolean;
  type?: string;
}

interface RemotePeer {
  identity: string;
  name: string;
  videoConsumer: Consumer | null;
  audioConsumer: Consumer | null;
  screenShareConsumer: Consumer | null;
}

// Speaks to a mediasoup-server over Socket.IO using the same RPC contract
// as hcw-v5 (request/response with method+data, server-initiated requests
// for newConsumer, notifications for peer lifecycle). The mediasoup-client
// SDK handles the WebRTC transports once signaling is established.
export class MediasoupService implements VideoCallImpl {
  private socket: Socket | null = null;
  private device: Device | null = null;
  private sendTransport: Transport | null = null;
  private recvTransport: Transport | null = null;

  private micProducer: Producer | null = null;
  private webcamProducer: Producer | null = null;
  private screenProducer: Producer | null = null;

  private consumers = new Map<string, Consumer>();
  private peers = new Map<string, RemotePeer>();

  private connectionStatus = new BehaviorSubject<ConnectionStatus>('disconnected');
  private participants = new BehaviorSubject<Map<string, ParticipantInfo>>(EMPTY_PARTICIPANTS);
  private localVideo = new BehaviorSubject<MediaStreamTrack | null>(null);
  private localAudio = new BehaviorSubject<MediaStreamTrack | null>(null);
  private localScreen = new BehaviorSubject<MediaStreamTrack | null>(null);
  private cameraEnabled = new BehaviorSubject<boolean>(false);
  private microphoneEnabled = new BehaviorSubject<boolean>(false);
  private screenShareEnabled = new BehaviorSubject<boolean>(false);
  private errorSubject = new Subject<string>();

  private cameraDeviceId: string | undefined;
  private microphoneDeviceId: string | undefined;
  private displayName = '';

  readonly connectionStatus$: Observable<ConnectionStatus> = this.connectionStatus.asObservable();
  readonly participants$: Observable<Map<string, ParticipantInfo>> = this.participants.asObservable();
  readonly localVideoTrack$: Observable<MediaStreamTrack | null> = this.localVideo.asObservable();
  readonly localAudioTrack$: Observable<MediaStreamTrack | null> = this.localAudio.asObservable();
  readonly localScreenShareTrack$: Observable<MediaStreamTrack | null> = this.localScreen.asObservable();
  readonly isCameraEnabled$: Observable<boolean> = this.cameraEnabled.asObservable();
  readonly isMicrophoneEnabled$: Observable<boolean> = this.microphoneEnabled.asObservable();
  readonly isScreenShareEnabled$: Observable<boolean> = this.screenShareEnabled.asObservable();
  readonly error$: Observable<string> = this.errorSubject.asObservable();

  async connect(config: VideoCallConfig, deviceIds?: VideoCallDeviceIds): Promise<void> {
    this.cameraDeviceId = deviceIds?.camera;
    this.microphoneDeviceId = deviceIds?.microphone;
    this.displayName = config.displayName ?? config.identity ?? 'Guest';

    this.connectionStatus.next('connecting');

    try {
      await this.openSocket(config);
      await this.loadDevice();
      await this.createTransports();
      await this.joinRoom();
      this.connectionStatus.next('connected');
    } catch (err) {
      this.connectionStatus.next('failed');
      this.errorSubject.next(err instanceof Error ? err.message : String(err));
      await this.disconnect();
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    try {
      this.micProducer?.close();
      this.webcamProducer?.close();
      this.screenProducer?.close();
      for (const consumer of this.consumers.values()) {
        consumer.close();
      }
      this.sendTransport?.close();
      this.recvTransport?.close();
      this.socket?.disconnect();
    } finally {
      this.micProducer = null;
      this.webcamProducer = null;
      this.screenProducer = null;
      this.consumers.clear();
      this.peers.clear();
      this.sendTransport = null;
      this.recvTransport = null;
      this.device = null;
      this.socket = null;
      this.localVideo.next(null);
      this.localAudio.next(null);
      this.localScreen.next(null);
      this.cameraEnabled.next(false);
      this.microphoneEnabled.next(false);
      this.screenShareEnabled.next(false);
      this.participants.next(EMPTY_PARTICIPANTS);
      this.connectionStatus.next('disconnected');
    }
  }

  async enableCamera(enable: boolean): Promise<void> {
    if (!this.sendTransport) {
      throw new Error('Not connected');
    }
    if (enable) {
      if (this.webcamProducer && !this.webcamProducer.closed) {
        await this.sendRequest('resumeProducer', { producerId: this.webcamProducer.id });
        this.cameraEnabled.next(true);
        this.localVideo.next(this.webcamProducer.track);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: this.cameraDeviceId
          ? { deviceId: { ideal: this.cameraDeviceId } }
          : true,
      });
      const track = stream.getVideoTracks()[0];
      this.webcamProducer = await this.sendTransport.produce({
        track,
        appData: { source: 'webcam' },
      });
      this.localVideo.next(track);
      this.cameraEnabled.next(true);
      this.webcamProducer.on('transportclose', () => {
        this.webcamProducer = null;
        this.localVideo.next(null);
        this.cameraEnabled.next(false);
      });
    } else if (this.webcamProducer) {
      const id = this.webcamProducer.id;
      this.webcamProducer.close();
      this.webcamProducer = null;
      this.localVideo.next(null);
      this.cameraEnabled.next(false);
      try {
        await this.sendRequest('closeProducer', { producerId: id });
      } catch {
        /* the server may have already cleaned it up */
      }
    }
  }

  async enableMicrophone(enable: boolean): Promise<void> {
    if (!this.sendTransport) {
      throw new Error('Not connected');
    }
    if (enable) {
      if (this.micProducer && !this.micProducer.closed) {
        await this.sendRequest('resumeProducer', { producerId: this.micProducer.id });
        this.microphoneEnabled.next(true);
        this.localAudio.next(this.micProducer.track);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: this.microphoneDeviceId
          ? { deviceId: { ideal: this.microphoneDeviceId } }
          : true,
      });
      const track = stream.getAudioTracks()[0];
      this.micProducer = await this.sendTransport.produce({
        track,
        codecOptions: {
          opusStereo: false,
          opusDtx: true,
          opusFec: true,
          opusPtime: 20,
          opusMaxPlaybackRate: 96000,
        },
        appData: { source: 'mic' },
      });
      this.localAudio.next(track);
      this.microphoneEnabled.next(true);
      this.micProducer.on('transportclose', () => {
        this.micProducer = null;
        this.localAudio.next(null);
        this.microphoneEnabled.next(false);
      });
    } else if (this.micProducer) {
      const id = this.micProducer.id;
      this.micProducer.close();
      this.micProducer = null;
      this.localAudio.next(null);
      this.microphoneEnabled.next(false);
      try {
        await this.sendRequest('closeProducer', { producerId: id });
      } catch {
        /* the server may have already cleaned it up */
      }
    }
  }

  async toggleCamera(): Promise<void> {
    await this.enableCamera(!this.cameraEnabled.value);
  }

  async toggleMicrophone(): Promise<void> {
    await this.enableMicrophone(!this.microphoneEnabled.value);
  }

  async startScreenShare(): Promise<void> {
    if (!this.sendTransport) {
      throw new Error('Not connected');
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track = stream.getVideoTracks()[0];
    this.screenProducer = await this.sendTransport.produce({
      track,
      appData: { source: 'screen' },
    });
    this.localScreen.next(track);
    this.screenShareEnabled.next(true);
    track.addEventListener('ended', () => {
      this.stopScreenShare().catch(() => undefined);
    });
  }

  async stopScreenShare(): Promise<void> {
    if (!this.screenProducer) {
      return;
    }
    const id = this.screenProducer.id;
    this.screenProducer.close();
    this.screenProducer = null;
    this.localScreen.next(null);
    this.screenShareEnabled.next(false);
    try {
      await this.sendRequest('closeProducer', { producerId: id });
    } catch {
      /* the server may have already cleaned it up */
    }
  }

  async toggleScreenShare(): Promise<void> {
    if (this.screenShareEnabled.value) {
      await this.stopScreenShare();
    } else {
      await this.startScreenShare();
    }
  }

  async switchCamera(deviceId: string): Promise<void> {
    this.cameraDeviceId = deviceId;
    if (this.cameraEnabled.value) {
      await this.enableCamera(false);
      await this.enableCamera(true);
    }
  }

  async switchMicrophone(deviceId: string): Promise<void> {
    this.microphoneDeviceId = deviceId;
    if (this.microphoneEnabled.value) {
      await this.enableMicrophone(false);
      await this.enableMicrophone(true);
    }
  }

  async switchSpeaker(_deviceId: string): Promise<void> {
    // Speaker selection happens at the HTMLMediaElement level via setSinkId;
    // the mediasoup signaling layer is not involved.
  }

  isConnected(): boolean {
    return this.connectionStatus.value === 'connected';
  }

  // ----- Internal: signaling and setup -----

  private async openSocket(config: VideoCallConfig): Promise<void> {
    const { io } = await import('socket.io-client');
    return new Promise((resolve, reject) => {
      const socket = io(config.url, {
        query: { token: config.token },
        transports: ['websocket', 'polling'],
      });

      const onConnectError = (err: Error) => {
        socket.off('connect', onConnect);
        reject(err);
      };
      const onConnect = () => {
        socket.off('connect_error', onConnectError);
        this.socket = socket;
        this.installSocketHandlers(socket);
        resolve();
      };

      socket.once('connect', onConnect);
      socket.once('connect_error', onConnectError);
    });
  }

  private installSocketHandlers(socket: Socket): void {
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        this.connectionStatus.next('disconnected');
      } else {
        this.connectionStatus.next('reconnecting');
      }
    });

    socket.on('reconnect', () => {
      this.connectionStatus.next('connected');
    });

    socket.on('request', async (request: { method: string; data: NewConsumerPayload }, cb: (err: unknown, response?: unknown) => void) => {
      try {
        if (request.method === 'newConsumer') {
          await this.handleNewConsumer(request.data);
          cb(null);
        } else {
          cb(new Error(`Unknown request method: ${request.method}`));
        }
      } catch (err) {
        cb(err);
      }
    });

    socket.on('notification', (notification: { method: string; data?: Record<string, unknown> }) => {
      this.handleNotification(notification).catch((err) => {
        this.errorSubject.next(err instanceof Error ? err.message : String(err));
      });
    });
  }

  private async loadDevice(): Promise<void> {
    const mediasoupClient = await import('mediasoup-client');
    // mediasoup-client is a CommonJS module; depending on the CJS/ESM interop
    // done by the bundler, the Device class may land on `.default`.
    const DeviceCtor =
      (mediasoupClient as any).Device ?? (mediasoupClient as any).default?.Device;
    // Keep a local const so the non-null type survives the await below
    // (TypeScript drops narrowing of mutable class fields across awaits).
    const device = new DeviceCtor();
    this.device = device;
    const routerRtpCapabilities = (await this.sendRequest(
      'getRouterRtpCapabilities',
    )) as RtpCapabilities & { headerExtensions?: { uri: string }[] };
    if (Array.isArray(routerRtpCapabilities.headerExtensions)) {
      routerRtpCapabilities.headerExtensions = routerRtpCapabilities.headerExtensions.filter(
        (ext: { uri: string }) => ext.uri !== 'urn:3gpp:video-orientation',
      );
    }
    await device.load({ routerRtpCapabilities });
  }

  private async createTransports(): Promise<void> {
    if (!this.device) {
      throw new Error('Device not loaded');
    }
    const sendInfo = (await this.sendRequest('createWebRtcTransport', {
      forceTcp: false,
      producing: true,
      consuming: false,
    })) as TransportParams;
    this.sendTransport = this.device.createSendTransport({
      id: sendInfo.id,
      iceParameters: sendInfo.iceParameters,
      iceCandidates: sendInfo.iceCandidates,
      dtlsParameters: sendInfo.dtlsParameters,
    });
    this.sendTransport.on(
      'connect',
      (
        { dtlsParameters }: { dtlsParameters: DtlsParameters },
        callback: () => void,
        errback: (err: Error) => void,
      ) => {
        this.sendRequest('connectWebRtcTransport', {
          transportId: this.sendTransport!.id,
          dtlsParameters,
        })
          .then(() => callback())
          .catch(errback);
      },
    );
    this.sendTransport.on(
      'produce',
      async (
        {
          kind,
          rtpParameters,
          appData,
        }: { kind: 'audio' | 'video'; rtpParameters: RtpParameters; appData: Record<string, unknown> },
        callback: (arg: { id: string }) => void,
        errback: (err: Error) => void,
      ) => {
        try {
          const response = (await this.sendRequest('produce', {
            transportId: this.sendTransport!.id,
            kind,
            rtpParameters,
            appData,
          })) as { id: string };
          callback({ id: response.id });
        } catch (err) {
          errback(err as Error);
        }
      },
    );

    const recvInfo = (await this.sendRequest('createWebRtcTransport', {
      forceTcp: false,
      producing: false,
      consuming: true,
    })) as TransportParams;
    this.recvTransport = this.device.createRecvTransport({
      id: recvInfo.id,
      iceParameters: recvInfo.iceParameters,
      iceCandidates: recvInfo.iceCandidates,
      dtlsParameters: recvInfo.dtlsParameters,
    });
    this.recvTransport.on(
      'connect',
      (
        { dtlsParameters }: { dtlsParameters: DtlsParameters },
        callback: () => void,
        errback: (err: Error) => void,
      ) => {
        this.sendRequest('connectWebRtcTransport', {
          transportId: this.recvTransport!.id,
          dtlsParameters,
        })
          .then(() => callback())
          .catch(errback);
      },
    );
  }

  private async joinRoom(): Promise<void> {
    if (!this.device) {
      throw new Error('Device not loaded');
    }
    const response = (await this.sendRequest('join', {
      displayName: this.displayName,
      rtpCapabilities: this.device.rtpCapabilities,
    })) as { peers?: { id: string; displayName?: string }[] };
    const peerList = response.peers ?? [];
    for (const peer of peerList) {
      this.ensurePeer(peer.id, peer.displayName ?? peer.id);
    }
    this.publishParticipants();
  }

  private async handleNewConsumer(data: NewConsumerPayload): Promise<void> {
    if (!this.recvTransport) {
      throw new Error('Recv transport not ready');
    }
    const consumer = await this.recvTransport.consume({
      id: data.id,
      producerId: data.producerId,
      kind: data.kind,
      rtpParameters: data.rtpParameters as RtpParameters,
      appData: { ...(data.appData ?? {}), peerId: data.peerId },
    });
    this.consumers.set(consumer.id, consumer);
    const source = (data.appData?.['source'] as string | undefined) ?? consumer.kind;
    const peer = this.ensurePeer(data.peerId, data.peerId);
    if (source === 'screen') {
      peer.screenShareConsumer = consumer;
    } else if (consumer.kind === 'video') {
      peer.videoConsumer = consumer;
    } else {
      peer.audioConsumer = consumer;
    }
    consumer.on('transportclose', () => {
      this.consumers.delete(consumer.id);
      this.removeConsumerFromPeer(consumer);
      this.publishParticipants();
    });
    this.publishParticipants();
  }

  private async handleNotification(notification: { method: string; data?: Record<string, unknown> }): Promise<void> {
    switch (notification.method) {
      case 'newPeer': {
        const id = notification.data?.['id'] as string | undefined;
        const name = (notification.data?.['displayName'] as string | undefined) ?? id ?? '';
        if (id) {
          this.ensurePeer(id, name);
          this.publishParticipants();
        }
        break;
      }
      case 'peerClosed': {
        const peerId = notification.data?.['peerId'] as string | undefined;
        if (peerId) {
          this.peers.delete(peerId);
          this.publishParticipants();
        }
        break;
      }
      case 'consumerClosed': {
        const consumerId = notification.data?.['consumerId'] as string | undefined;
        if (consumerId) {
          const consumer = this.consumers.get(consumerId);
          if (consumer) {
            consumer.close();
            this.consumers.delete(consumerId);
            this.removeConsumerFromPeer(consumer);
            this.publishParticipants();
          }
        }
        break;
      }
      case 'consumerPaused':
      case 'consumerResumed':
        this.publishParticipants();
        break;
      default:
        break;
    }
  }

  private ensurePeer(identity: string, displayName: string): RemotePeer {
    let peer = this.peers.get(identity);
    if (!peer) {
      peer = {
        identity,
        name: displayName,
        videoConsumer: null,
        audioConsumer: null,
        screenShareConsumer: null,
      };
      this.peers.set(identity, peer);
    } else if (displayName && peer.name !== displayName) {
      peer.name = displayName;
    }
    return peer;
  }

  private removeConsumerFromPeer(consumer: Consumer): void {
    for (const peer of this.peers.values()) {
      if (peer.videoConsumer === consumer) {
        peer.videoConsumer = null;
      }
      if (peer.audioConsumer === consumer) {
        peer.audioConsumer = null;
      }
      if (peer.screenShareConsumer === consumer) {
        peer.screenShareConsumer = null;
      }
    }
  }

  private publishParticipants(): void {
    const out = new Map<string, ParticipantInfo>();
    for (const [identity, peer] of this.peers) {
      out.set(identity, {
        identity,
        name: peer.name || identity,
        isSpeaking: false,
        isCameraEnabled: !!peer.videoConsumer && !peer.videoConsumer.paused,
        isMicrophoneEnabled: !!peer.audioConsumer && !peer.audioConsumer.paused,
        isScreenShareEnabled: !!peer.screenShareConsumer && !peer.screenShareConsumer.paused,
        videoTrack: peer.videoConsumer?.track ?? null,
        audioTrack: peer.audioConsumer?.track ?? null,
        screenShareTrack: peer.screenShareConsumer?.track ?? null,
      });
    }
    this.participants.next(out);
  }

  private sendRequest(method: string, data?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not connected'));
        return;
      }
      const timer = setTimeout(() => {
        reject(new Error(`Mediasoup request "${method}" timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.socket.emit('request', { method, data }, (err: unknown, response: unknown) => {
        clearTimeout(timer);
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        } else {
          resolve(response);
        }
      });
    });
  }
}

interface TransportParams {
  id: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
}
