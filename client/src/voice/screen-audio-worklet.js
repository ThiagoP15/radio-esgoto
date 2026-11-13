// Recebe PCM Float32 estéreo (48 kHz, intercalado) e o toca num AudioWorkletNode,
// cuja saída vira a MediaStreamTrack enviada aos peers.
class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.offset = 0; // posição (em floats) dentro de chunks[0]
    this.queued = 0; // frames na fila
    this.maxFrames = 48000 * 0.25; // limita a latência a ~250 ms (descarta o mais antigo)

    this.port.onmessage = ({ data }) => {
      const chunk = new Float32Array(data);
      this.chunks.push(chunk);
      this.queued += chunk.length / 2;
      while (this.queued > this.maxFrames && this.chunks.length > 1) {
        const dropped = this.chunks.shift();
        this.queued -= (dropped.length - this.offset) / 2;
        this.offset = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    for (let i = 0; i < left.length; i++) {
      const chunk = this.chunks[0];
      if (!chunk) {
        left[i] = 0;
        right[i] = 0;
        continue;
      }
      left[i] = chunk[this.offset];
      right[i] = chunk[this.offset + 1];
      this.offset += 2;
      this.queued -= 1;
      if (this.offset >= chunk.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-player', PcmPlayer);
