// Ponte entre a chamada de voz (janela principal) e o overlay para jogos (outra janela do Electron).
// A detecção de voz (AnalyserNode) PRECISA rodar aqui: só esta janela enxerga os MediaStream da chamada.
// O overlay recebe só dados simples por IPC: quem está na sala e quem está falando agora.
import { useEffect, useRef } from 'react';

// --- Preferência (mesmo padrão do fx.js e do UiSounds.js): desligado por padrão ----------
const PREF_KEY = 'radioesgoto.overlay';
export function getOverlayPref() {
  try {
    return localStorage.getItem(PREF_KEY) === 'on';
  } catch {
    return false;
  }
}
export function setOverlayPref(on) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* sem persistência, vale só nesta sessão */
  }
}

// --- Sensibilidade da detecção de voz (ajuste aqui se acender com ruído ou não acender ao falar) ---
const FFT_SIZE = 1024; // janela de ~21 ms por leitura
const TICK_MS = 80; // frequência das leituras
const ON_RMS = 0.015; // volume (RMS, 0 a 1) para COMEÇAR a contar como "falando"
const OFF_RMS = 0.01; // enquanto falando, só precisa passar disto para continuar (histerese)
const HOLD_MS = 350; // segura o "falando" por este tempo após o último som (cobre pausas entre palavras)

/**
 * Mede, por participante, se há voz agora. Um AudioContext só, uma análise (AnalyserNode) por fonte.
 * As análises ficam SEM saída: não tocam som nenhum e não alteram o áudio da chamada.
 */
export class VoiceActivityMonitor {
  constructor() {
    this.onChange = null; // chamado quando alguém começa/para de falar
    this.ctx = null;
    this.entries = new Map(); // id -> { stream, source, analyser, data, speaking, lastLoud }
    this.timer = null;
  }

  isSpeaking(id) {
    return this.entries.get(id)?.speaking ?? false;
  }

  /** sources: [{ id, stream }]. Cria/remove análises conforme a lista muda. */
  sync(sources) {
    const wanted = new Map();
    for (const { id, stream } of sources) {
      if (stream && stream.getAudioTracks().length > 0) wanted.set(id, stream);
    }

    for (const [id, entry] of this.entries) {
      if (wanted.get(id) !== entry.stream) {
        this.release(entry);
        this.entries.delete(id);
      }
    }

    for (const [id, stream] of wanted) {
      if (this.entries.has(id)) continue;
      try {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        const source = this.ctx.createMediaStreamSource(stream);
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        source.connect(analyser);
        this.entries.set(id, {
          stream,
          source,
          analyser,
          data: new Float32Array(analyser.fftSize),
          speaking: false,
          lastLoud: -Infinity,
        });
      } catch (err) {
        console.warn('[overlay] sem detecção de voz para', id, err?.message);
      }
    }

    if (this.entries.size > 0 && !this.timer) {
      this.timer = setInterval(() => this.tick(), TICK_MS);
    } else if (this.entries.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  tick(now = performance.now()) {
    let changed = false;
    for (const entry of this.entries.values()) {
      entry.analyser.getFloatTimeDomainData(entry.data);
      let sum = 0;
      for (let i = 0; i < entry.data.length; i += 1) sum += entry.data[i] * entry.data[i];
      const rms = Math.sqrt(sum / entry.data.length);

      if (rms >= (entry.speaking ? OFF_RMS : ON_RMS)) entry.lastLoud = now;
      const speaking = now - entry.lastLoud < HOLD_MS;
      if (speaking !== entry.speaking) {
        entry.speaking = speaking;
        changed = true;
      }
    }
    if (changed) this.onChange?.();
  }

  release(entry) {
    try {
      entry.source.disconnect();
      entry.analyser.disconnect();
    } catch {
      /* já desconectado */
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.onChange = null;
  }
}

/**
 * Mantém o overlay em sincronia com a chamada. Só faz algo no Electron (window.radioEsgoto.overlay).
 * - enabled: o overlay deve estar aberto agora (ligado pelo usuário E conectado na chamada)
 * - getLocalStream: devolve o MediaStream do seu microfone (mudo = silêncio = não acende)
 */
export function useOverlayBridge({ enabled, selfName, selfAvatar, peers, noiseSuppression, getLocalStream }) {
  const api = typeof window === 'undefined' ? undefined : window.radioEsgoto?.overlay;
  const monitorRef = useRef(null);
  const listRef = useRef([]); // [{ id, name, avatar }]
  const getLocalStreamRef = useRef(getLocalStream);
  getLocalStreamRef.current = getLocalStream;

  // 1) Abre/fecha a janela do overlay (a janela some ao sair da chamada ou desligar).
  useEffect(() => {
    if (!api || !enabled) return undefined;
    api.setOpen(true).catch(() => {});
    return () => {
      api.setOpen(false).catch(() => {});
    };
  }, [api, enabled]);

  // 2) Monitor de voz: cada mudança de "quem está falando" vira uma atualização para o overlay.
  useEffect(() => {
    if (!api || !enabled) return undefined;
    const monitor = new VoiceActivityMonitor();
    monitor.onChange = () => {
      api.update({
        participants: listRef.current.map((p) => ({ ...p, speaking: monitor.isSpeaking(p.id) })),
      });
    };
    monitorRef.current = monitor;
    return () => {
      monitor.stop();
      monitorRef.current = null;
    };
  }, [api, enabled]);

  // 3) Sala mudou (alguém entrou/saiu, trocou foto, microfone recriado): atualiza lista e fontes de áudio.
  useEffect(() => {
    const monitor = monitorRef.current;
    if (!api || !enabled || !monitor) return;

    const list = [{ id: 'self', name: selfName, avatar: selfAvatar ?? null }];
    const sources = [{ id: 'self', stream: getLocalStreamRef.current() }];
    for (const peer of peers) {
      list.push({ id: peer.id, name: peer.user?.username ?? '?', avatar: peer.user?.avatar_url ?? null });
      sources.push({ id: peer.id, stream: peer.audioStream });
    }
    listRef.current = list;
    monitor.sync(sources);
    monitor.onChange?.(); // envia a lista nova na hora
  }, [api, enabled, selfName, selfAvatar, peers, noiseSuppression]);
}
