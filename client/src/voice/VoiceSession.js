/**
 * Sessão de voz em malha P2P (mesh): uma RTCPeerConnection por pessoa na sala.
 * O Socket.io só faz a sinalização (offer / answer / ice-candidate), sempre dentro da sala.
 */
import screenAudioWorkletUrl from './screen-audio-worklet.js?url';

const audioConstraints = (enabled) => ({
  noiseSuppression: enabled,
  echoCancellation: enabled,
  autoGainControl: enabled,
});

export const SCREEN_QUALITY_PRESETS = {
  '720p60': {
    id: '720p60',
    label: '720p • 60 FPS (Leve)',
    width: 1280,
    height: 720,
    fps: 60,
    maxBitrate: 3_500_000, // 3.5 Mbps
    minBitrateKbps: 1200,
    startBitrateKbps: 2500,
    maxBitrateKbps: 3500,
  },
  '1080p60': {
    id: '1080p60',
    label: '1080p • 60 FPS (Alta)',
    width: 1920,
    height: 1080,
    fps: 60,
    maxBitrate: 6_000_000, // 6 Mbps
    minBitrateKbps: 2000,
    startBitrateKbps: 4000,
    maxBitrateKbps: 6000,
  },
  '1080p120': {
    id: '1080p120',
    label: '1080p • 120 FPS (Ultra)',
    width: 1920,
    height: 1080,
    fps: 120,
    maxBitrate: 8_500_000, // 8.5 Mbps
    minBitrateKbps: 2500,
    startBitrateKbps: 5500,
    maxBitrateKbps: 8500,
  },
};

const SCREEN_AUDIO_MAX_BITRATE = 256_000; // 256 kbps estéreo

function enhanceSdpQuality(sdp, preset) {
  if (!sdp) return sdp;
  const p = preset || SCREEN_QUALITY_PRESETS['1080p120'];
  let out = sdp;

  out = out.replace(
    /(a=fmtp:\d+ (?:profile-level-id|level-asymmetry-allowed|apt)=[^\r\n]+)/g,
    `$1;x-google-min-bitrate=${p.minBitrateKbps};x-google-start-bitrate=${p.startBitrateKbps};x-google-max-bitrate=${p.maxBitrateKbps}`,
  );

  out = out.replace(
    /a=fmtp:(\d+) minptime=10;useinbandfec=1/g,
    'a=fmtp:$1 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=256000',
  );

  return out;
}

export class VoiceSession {
  constructor({ socket, channelId, iceServers = [], onUpdate }) {
    this.socket = socket;
    this.channelId = channelId;
    this.iceServers = iceServers;
    this.onUpdate = onUpdate;

    this.peers = new Map(); // socketId -> estado do peer
    this.localStream = null;
    this.screenStream = null;
    this.shareAudio = null;
    this.noiseSuppression = true;
    this.screenQuality = '1080p120';
    this.stopped = false;

    this.listeners = {
      'voice:peer-joined': ({ socketId, user }) => this.createPeer(socketId, user),
      'voice:peer-left': ({ socketId }) => this.closePeer(socketId),
      'voice:screen': (payload) => this.onRemoteScreen(payload),
      offer: (payload) => this.onDescription(payload),
      answer: (payload) => this.onDescription(payload),
      'ice-candidate': (payload) => this.onCandidate(payload),
    };
  }

  getPreset() {
    return SCREEN_QUALITY_PRESETS[this.screenQuality] || SCREEN_QUALITY_PRESETS['1080p120'];
  }

  async setScreenQuality(qualityId) {
    if (!SCREEN_QUALITY_PRESETS[qualityId]) return;
    this.screenQuality = qualityId;
    const preset = this.getPreset();

    if (this.screenStream) {
      const [videoTrack] = this.screenStream.getVideoTracks();
      if (videoTrack) {
        try {
          await videoTrack.applyConstraints({
            width: { ideal: preset.width, max: preset.width },
            height: { ideal: preset.height, max: preset.height },
            frameRate: { ideal: preset.fps, max: preset.fps },
          });
        } catch {
          // Alguns drivers exigem reiniciar o compartilhamento para mudar resolução, mas o bitrate/fps no sender é atualizado abaixo
        }
      }
      for (const peer of this.peers.values()) {
        this.applySenderBitrate(peer);
      }
    }
    this.emitUpdate();
  }

  async start() {
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(true) });
    if (this.stopped) return this.releaseLocalStream();

    for (const [event, handler] of Object.entries(this.listeners)) this.socket.on(event, handler);

    const res = await this.request('voice:join', { channelId: this.channelId });
    if (this.stopped) return undefined;
    if (!res?.ok) {
      this.stop();
      throw new Error(res?.error ?? 'Não foi possível entrar na sala.');
    }

    for (const peer of res.peers) this.createPeer(peer.socketId, peer.user, peer.screenStreamId);
    this.emitUpdate();
    return undefined;
  }

  request(event, payload) {
    return new Promise((resolve, reject) => {
      this.socket.timeout(8000).emit(event, payload, (err, res) => (err ? reject(err) : resolve(res)));
    });
  }

  // --- Peers ------------------------------------------------------------------
  createPeer(id, user, screenStreamId = null) {
    if (this.stopped || this.peers.has(id)) return;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer = {
      id,
      user,
      pc,
      polite: this.socket.id < id,
      makingOffer: false,
      ignoreOffer: false,
      pendingCandidates: [],
      screenSenders: [],
      screenStreamId,
      audioStream: null,
      screenStream: null,
    };
    this.peers.set(id, peer);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.socket.emit('ice-candidate', { to: id, data: candidate.toJSON() });
    };

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.socket.emit('offer', {
          to: id,
          data: {
            type: pc.localDescription.type,
            sdp: enhanceSdpQuality(pc.localDescription.sdp, this.getPreset()),
          },
        });
      } catch (err) {
        console.error('[voz] falha ao negociar', err);
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') pc.restartIce();
    };

    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      const isScreen = track.kind === 'video' || (peer.screenStreamId && stream.id === peer.screenStreamId);
      if (isScreen) {
        peer.screenStream = stream;
        peer.screenStreamId ??= stream.id;
        stream.onremovetrack = () => {
          if (stream.getVideoTracks().length === 0 && peer.screenStream === stream) {
            peer.screenStream = null;
            this.emitUpdate();
          }
        };
      } else {
        peer.audioStream = stream;
      }
      this.emitUpdate();
    };

    for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
    if (this.screenStream) this.addScreenTracks(peer);
    this.emitUpdate();
  }

  closePeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc.close();
    this.peers.delete(id);
    this.emitUpdate();
  }

  // --- Sinalização --------------------------------------------------------------
  async onDescription({ from, data: description }) {
    const peer = this.peers.get(from);
    if (!peer) return;
    const { pc } = peer;

    try {
      if (description.type === 'offer') {
        const collision = peer.makingOffer || pc.signalingState !== 'stable';
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;

        await pc.setRemoteDescription(description);
        await this.flushCandidates(peer);
        await pc.setLocalDescription();
        this.socket.emit('answer', {
          to: from,
          data: {
            type: pc.localDescription.type,
            sdp: enhanceSdpQuality(pc.localDescription.sdp, this.getPreset()),
          },
        });
      } else {
        await pc.setRemoteDescription(description);
        await this.flushCandidates(peer);
        if (peer.screenSenders.length > 0) {
          this.applySenderBitrate(peer);
        }
      }
    } catch (err) {
      console.error('[voz] falha ao aplicar descrição remota', err);
    }
  }

  async onCandidate({ from, data: candidate }) {
    const peer = this.peers.get(from);
    if (!peer) return;
    if (!peer.pc.remoteDescription) {
      peer.pendingCandidates.push(candidate);
      return;
    }
    try {
      await peer.pc.addIceCandidate(candidate);
    } catch (err) {
      if (!peer.ignoreOffer) console.warn('[voz] candidato ICE rejeitado', err);
    }
  }

  async flushCandidates(peer) {
    for (const candidate of peer.pendingCandidates.splice(0)) {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch (err) {
        if (!peer.ignoreOffer) console.warn('[voz] candidato ICE rejeitado', err);
      }
    }
  }

  // --- Compartilhamento de tela -------------------------------------------------
  async startScreenShare(sourceId = null, qualityId = null) {
    if (this.screenStream || this.stopped) return;
    if (qualityId && SCREEN_QUALITY_PRESETS[qualityId]) {
      this.screenQuality = qualityId;
    }
    const preset = this.getPreset();

    const display = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: preset.width, max: preset.width },
        height: { ideal: preset.height, max: preset.height },
        frameRate: { ideal: preset.fps, max: preset.fps },
      },
      audio: false,
    });
    const [video] = display.getVideoTracks();

    if ('contentHint' in video) {
      video.contentHint = 'motion';
    }

    const stream = new MediaStream([video]);

    const audioTrack = await this.startShareAudio(sourceId).catch((err) => {
      console.warn('[voz] áudio do compartilhamento indisponível', err);
      return null;
    });
    if (audioTrack) stream.addTrack(audioTrack);

    this.screenStream = stream;

    this.socket.emit('voice:screen', { sharing: true, streamId: stream.id });
    for (const peer of this.peers.values()) this.addScreenTracks(peer);

    video.addEventListener('ended', () => this.stopScreenShare());
    this.emitUpdate();
  }

  async startShareAudio(sourceId) {
    const native = window.radioEsgoto?.screenAudio;
    if (!native || !sourceId) return null;

    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule(screenAudioWorkletUrl);
    const node = new AudioWorkletNode(ctx, 'pcm-player', { numberOfInputs: 0, outputChannelCount: [2] });
    const dest = ctx.createMediaStreamDestination();
    node.connect(dest);

    const off = native.onChunk((buf) => node.port.postMessage(buf, [buf]));
    const res = await native.start(sourceId);
    if (!res?.ok) {
      off();
      node.disconnect();
      await ctx.close();
      console.info('[voz] compartilhando só vídeo:', res?.reason);
      return null;
    }

    console.info('[voz] áudio do compartilhamento ativo:', res);
    this.shareAudio = { ctx, node, off, native };
    const [track] = dest.stream.getAudioTracks();
    if (track && 'contentHint' in track) {
      track.contentHint = 'music';
    }
    return track;
  }

  stopShareAudio() {
    const share = this.shareAudio;
    if (!share) return;
    this.shareAudio = null;
    share.off();
    share.native.stop().catch(() => {});
    share.node.disconnect();
    share.ctx.close().catch(() => {});
  }

  addScreenTracks(peer) {
    peer.screenSenders = this.screenStream.getTracks().map((track) => peer.pc.addTrack(track, this.screenStream));
    this.applySenderBitrate(peer);
  }

  applySenderBitrate(peer) {
    const preset = this.getPreset();
    for (const sender of peer.screenSenders) {
      if (!sender.track) continue;
      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }

        if (sender.track.kind === 'video') {
          params.encodings[0].maxBitrate = preset.maxBitrate;
          params.encodings[0].maxFramerate = preset.fps;
          params.encodings[0].priority = 'high';
          params.encodings[0].networkPriority = 'high';
          params.degradationPreference = 'maintain-framerate';
        } else if (sender.track.kind === 'audio') {
          params.encodings[0].maxBitrate = SCREEN_AUDIO_MAX_BITRATE;
          params.encodings[0].priority = 'high';
          params.encodings[0].networkPriority = 'high';
        }

        sender.setParameters(params).catch(() => {});
      } catch {
        // Ignora se ainda não negociado
      }
    }
  }

  stopScreenShare() {
    if (!this.screenStream) return;

    for (const peer of this.peers.values()) {
      for (const sender of peer.screenSenders) {
        try {
          peer.pc.removeTrack(sender);
        } catch {
          /* conexão já fechada */
        }
      }
      peer.screenSenders = [];
    }
    this.stopShareAudio();
    this.screenStream.getTracks().forEach((track) => track.stop());
    this.screenStream = null;
    this.socket.emit('voice:screen', { sharing: false });
    this.emitUpdate();
  }

  onRemoteScreen({ from, sharing, streamId }) {
    const peer = this.peers.get(from);
    if (!peer) return;
    peer.screenStreamId = sharing ? streamId : null;
    if (!sharing) peer.screenStream = null;
    this.emitUpdate();
  }

  // --- Microfone ------------------------------------------------------------------
  setMuted(muted) {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  async setNoiseSuppression(enabled) {
    const track = this.localStream?.getAudioTracks()[0];
    if (!track || this.stopped) return;

    try {
      await track.applyConstraints(audioConstraints(enabled));
    } catch {
      const fresh = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(enabled) });
      const [next] = fresh.getAudioTracks();
      next.enabled = track.enabled;
      for (const peer of this.peers.values()) {
        const sender = peer.pc.getSenders().find((s) => s.track === track);
        await sender?.replaceTrack(next);
      }
      this.localStream.removeTrack(track);
      track.stop();
      this.localStream.addTrack(next);
    }
    this.noiseSuppression = enabled;
    this.emitUpdate();
  }

  releaseLocalStream() {
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
  }

  stop() {
    if (this.stopped) return;
    this.stopScreenShare();
    this.stopped = true;

    for (const [event, handler] of Object.entries(this.listeners)) this.socket.off(event, handler);
    if (this.socket.connected) this.socket.emit('voice:leave');

    for (const peer of this.peers.values()) peer.pc.close();
    this.peers.clear();
    this.releaseLocalStream();
  }

  emitUpdate() {
    if (this.stopped) return;
    this.onUpdate({
      sharing: Boolean(this.screenStream),
      screenStream: this.screenStream,
      noiseSuppression: this.noiseSuppression,
      screenQuality: this.screenQuality,
      peers: [...this.peers.values()].map((p) => ({
        id: p.id,
        user: p.user,
        audioStream: p.audioStream,
        screenStream: p.screenStream,
      })),
    });
  }
}