// Efeitos sonoros da interface (mutar/desmutar, entrar/sair de canal de voz).
// Sintetizados com Web Audio: nenhum arquivo de áudio, então não depende de `media-src` nem do protocolo app://.
// Usa um AudioContext PRÓPRIO e isolado: não toca no áudio das chamadas, nas transmissões nem no AudioWorklet.
// Ligado por padrão; a preferência fica no localStorage (mesmo padrão do fx.js).
const KEY = 'radioesgoto.uisounds';

const MASTER_GAIN = 0.7; // volume geral dos efeitos (0 a 1): ajuste aqui se ficar alto/baixo
const LOWPASS_HZ = 3200; // corta o brilho agudo: som "seco", de metal abafado

let enabled = true;
try {
  enabled = localStorage.getItem(KEY) !== 'off';
} catch {
  /* localStorage indisponível: mantém ligado */
}

export const getUiSounds = () => enabled;

export function setUiSounds(value) {
  enabled = Boolean(value);
  try {
    localStorage.setItem(KEY, enabled ? 'on' : 'off');
  } catch {
    /* sem persistência, vale só nesta sessão */
  }
}

let ctx = null;
let out = null;

function getContext() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx({ latencyHint: 'interactive' });

    const master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = LOWPASS_HZ;
    master.connect(filter);
    filter.connect(ctx.destination);
    out = master;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Nota curta com ataque instantâneo e queda exponencial (som "seco").
function tone(c, { freq, endFreq = freq, at = 0, dur = 0.09, type = 'triangle', peak = 0.14 }) {
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(out);
  osc.onended = () => gain.disconnect();
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// Estalo metálico de ~20 ms (ruído filtrado), dá o "clique" industrial no início do som.
function tick(c, { at = 0, peak = 0.16, freq = 1600 } = {}) {
  const t0 = c.currentTime + at;
  const length = Math.floor(c.sampleRate * 0.02);
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);

  const src = c.createBufferSource();
  src.buffer = buffer;
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = 1.2;
  const gain = c.createGain();
  gain.gain.value = peak;
  src.connect(band);
  band.connect(gain);
  gain.connect(out);
  src.onended = () => gain.disconnect();
  src.start(t0);
}

const SOUNDS = {
  mute: (c) => {
    tick(c);
    tone(c, { freq: 420, endFreq: 300, dur: 0.1 });
  },
  unmute: (c) => {
    tick(c);
    tone(c, { freq: 300, endFreq: 440, dur: 0.1 });
  },
  join: (c) => {
    tone(c, { freq: 330, dur: 0.08 });
    tone(c, { freq: 495, at: 0.07, dur: 0.13 });
  },
  leave: (c) => {
    tone(c, { freq: 495, dur: 0.08 });
    tone(c, { freq: 330, at: 0.07, dur: 0.15 });
  },
};

/** Toca um efeito: 'mute' | 'unmute' | 'join' | 'leave'. Silencioso se desativado ou sem suporte. */
export function playUiSound(name) {
  if (!enabled) return;
  const sound = SOUNDS[name];
  if (!sound) return;
  try {
    const c = getContext();
    if (c) sound(c);
  } catch (err) {
    console.warn('[sons] falha ao tocar efeito:', name, err?.message);
  }
}