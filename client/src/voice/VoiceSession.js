/**
 * Sessão de voz em malha P2P (mesh): uma RTCPeerConnection por pessoa na sala.
 * O Socket.io só faz a sinalização (offer / answer / ice-candidate), sempre dentro da sala.
 */
const audioConstraints = (enabled) => ({
  noiseSuppression: enabled,
  echoCancellation: enabled,
  autoGainControl: enabled,
});

export class VoiceSession {
  constructor({ socket, channelId, iceServers = [], onUpdate }) {
    this.socket = socket;
    this.channelId = channelId;
    this.iceServers = iceServers;
    this.onUpdate = onUpdate;

    this.peers = new Map(); // socketId -> estado do peer
    this.localStream = null;
    this.screenStream = null;
    this.noiseSuppression = true;
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
        this.socket.emit('offer', { to: id, data: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
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
        this.socket.emit('answer', { to: from, data: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      } else {
        await pc.setRemoteDescription(description);
        await this.flushCandidates(peer);
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

  // --- Compartilhamento de tela (Sem Eco) ---------------------------------------
  async startScreenShare() {
    if (this.screenStream || this.stopped) return;

    // Captura apenas vídeo (audio: false) ou exclui áudio do sistema para impedir
    // que a saída de som do Rádio Esgoto volte para a chamada gerando microfonia/eco.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 30, max: 60 },
      },
      audio: false,
    });

    this.screenStream = stream;

    this.socket.emit('voice:screen', { sharing: true, streamId: stream.id });
    for (const peer of this.peers.values()) this.addScreenTracks(peer);

    stream.getVideoTracks()[0]?.addEventListener('ended', () => this.stopScreenShare());
    this.emitUpdate();
  }

  addScreenTracks(peer) {
    peer.screenSenders = this.screenStream.getTracks().map((track) => peer.pc.addTrack(track, this.screenStream));
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
      peers: [...this.peers.values()].map((p) => ({
        id: p.id,
        user: p.user,
        audioStream: p.audioStream,
        screenStream: p.screenStream,
      })),
    });
  }
}