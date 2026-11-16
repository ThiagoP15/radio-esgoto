import { useEffect, useRef, useState } from 'react';
import { toast } from '../toast.js';

const LIMIT_LABEL = { none: 'nenhum', cpu: 'CPU', bandwidth: 'banda', other: 'outro' };

function formatBitrate(bps) {
  if (!Number.isFinite(bps)) return '—';
  return bps >= 1_000_000 ? `${(bps / 1_000_000).toFixed(2).replace('.', ',')} Mbps` : `${Math.round(bps / 1000)} kbps`;
}

// Painel "Nerd Stats". stats: undefined = coletando · null = sem dados · objeto = leitura do getScreenStats().
function StatsPanel({ stats, inline }) {
  const className = `video-stats ${inline ? 'is-inline' : ''}`;

  if (stats === undefined || stats === null || (stats.direction === 'out' && !stats.peers)) {
    let note = 'coletando…';
    if (stats === null) note = 'sem dados da conexão';
    else if (stats?.direction === 'out') note = 'ninguém recebendo ainda';
    return (
      <div className={className} role="group" aria-label="Estatísticas da transmissão" aria-live="off">
        <div className="video-stats-note">{note}</div>
      </div>
    );
  }

  const out = stats.direction === 'out';
  return (
    <div className={className} role="group" aria-label="Estatísticas da transmissão" aria-live="off">
      <div className="video-stats-title">{out ? 'ENVIO' : 'RECEBIMENTO'}</div>
      <dl className="video-stats-grid">
        <dt>BITRATE</dt>
        <dd>{formatBitrate(stats.bitrate)}</dd>
        <dt>FPS</dt>
        <dd>{Number.isFinite(stats.fps) ? Math.round(stats.fps) : '—'}</dd>
        <dt>RESOLUÇÃO</dt>
        <dd>{stats.width && stats.height ? `${stats.width}×${stats.height}` : '—'}</dd>
        <dt>CODEC</dt>
        <dd>{stats.codec ?? '—'}</dd>
        <dt>PING</dt>
        <dd>{Number.isFinite(stats.rttMs) ? `${Math.round(stats.rttMs)} ms` : '—'}</dd>
        {out && (
          <>
            <dt>LIMITADO POR</dt>
            <dd>{LIMIT_LABEL[stats.limitation] ?? '—'}</dd>
            <dt>ENVIANDO PARA</dt>
            <dd>
              {stats.peers} {stats.peers === 1 ? 'pessoa' : 'pessoas'}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

function VideoTile({ tile, isCinema, canCinema, onToggleCinema }) {
  const tileRef = useRef(null);
  const videoRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Se for a sua própria tela (local), começa com o preview pausado para não criar espelho infinito nem bugar o driver
  const [showLocalPreview, setShowLocalPreview] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState(undefined);
  const hasStats = typeof tile.getStats === 'function';
  // O VoiceChannel recria os tiles a cada render; guardamos a função numa ref para o intervalo não reiniciar.
  const getStatsRef = useRef(tile.getStats);
  getStatsRef.current = tile.getStats;

  // Volume do som do compartilhamento (só tiles remotos; o local fica sempre mudo).
  const [volume, setVolume] = useState(1);
  const [hasAudio, setHasAudio] = useState(
    () => !tile.local && (tile.stream?.getAudioTracks().length ?? 0) > 0,
  );

  const shouldRenderVideo = !tile.local || showLocalPreview;
  const pipSupported = typeof document !== 'undefined' && document.pictureInPictureEnabled === true;

  useEffect(() => {
    const stream = tile.stream;
    if (!stream || tile.local) {
      setHasAudio(false);
      return;
    }

    const checkAudio = () => setHasAudio(stream.getAudioTracks().length > 0);
    checkAudio();

    stream.addEventListener('addtrack', checkAudio);
    stream.addEventListener('removetrack', checkAudio);
    return () => {
      stream.removeEventListener('addtrack', checkAudio);
      stream.removeEventListener('removetrack', checkAudio);
    };
  }, [tile.stream, tile.local]);

  useEffect(() => {
    const video = videoRef.current;
    if (video && shouldRenderVideo) {
      video.srcObject = tile.stream;
      video.volume = volume;
    }
    return () => {
      if (video) video.srcObject = null;
    };
  }, [tile.stream, shouldRenderVideo]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
    }
  }, [volume, shouldRenderVideo]);

  // Acompanha a entrada/saída do Picture-in-Picture (inclusive quando o usuário fecha a janelinha flutuante).
  // Se o <video> sair da tela (prévia oculta, transmissão encerrada), fecha o PiP junto.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !shouldRenderVideo) {
      setIsPip(false);
      return undefined;
    }
    const onEnter = () => setIsPip(true);
    const onLeave = () => setIsPip(false);
    video.addEventListener('enterpictureinpicture', onEnter);
    video.addEventListener('leavepictureinpicture', onLeave);
    return () => {
      video.removeEventListener('enterpictureinpicture', onEnter);
      video.removeEventListener('leavepictureinpicture', onLeave);
      if (document.pictureInPictureElement === video) {
        document.exitPictureInPicture().catch(() => {});
      }
    };
  }, [shouldRenderVideo]);

  // Nerd Stats: lê as estatísticas do WebRTC a cada 1 s enquanto o painel estiver aberto.
  // O bitrate é a diferença de bytes entre duas leituras (por isso a primeira mostra "—").
  useEffect(() => {
    if (!showStats || !hasStats) {
      setStats(undefined);
      return undefined;
    }
    let cancelled = false;
    let prev = null;

    const tick = async () => {
      try {
        const next = await getStatsRef.current?.();
        if (cancelled) return;
        if (!next) {
          prev = null;
          setStats(null);
          return;
        }
        let bitrate = null;
        if (prev && prev.peers === next.peers && next.timestamp > prev.timestamp && next.bytes >= prev.bytes) {
          bitrate = ((next.bytes - prev.bytes) * 8) / ((next.timestamp - prev.timestamp) / 1000);
        }
        prev = next;
        setStats({ ...next, bitrate });
      } catch {
        if (!cancelled) setStats(null);
      }
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [showStats, hasStats]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (document.fullscreenElement) {
        setIsFullscreen(document.fullscreenElement === tileRef.current);
      } else if (!window.radioEsgoto?.setFullScreen) {
        setIsFullscreen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        window.radioEsgoto?.setFullScreen?.(false);
      }
    };

    const unsubscribeElectron = window.radioEsgoto?.onFullScreenChange?.((isFull) => {
      if (!isFull) setIsFullscreen(false);
    });

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('keydown', handleKeyDown);
      unsubscribeElectron?.();
    };
  }, [isFullscreen]);

  // Esc sai do Modo Cinema. Se a tela cheia estiver ativa, o primeiro Esc só sai dela (handler acima).
  useEffect(() => {
    if (!isCinema) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !isFullscreen) onToggleCinema();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isCinema, isFullscreen, onToggleCinema]);

  const toggleFullscreen = async () => {
    const container = tileRef.current;
    if (!container) return;

    const nextState = !isFullscreen;

    if (window.radioEsgoto?.setFullScreen) {
      await window.radioEsgoto.setFullScreen(nextState);
      setIsFullscreen(nextState);
      return;
    }

    try {
      if (nextState) {
        await container.requestFullscreen();
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
      setIsFullscreen(nextState);
    } catch {
      setIsFullscreen(nextState);
    }
  };

  const togglePip = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      // Ex.: InvalidStateError quando o primeiro quadro ainda não chegou.
      console.warn('[pip] falha:', err?.name, err?.message);
      toast('Não foi possível abrir o Picture-in-Picture agora. Tente de novo em instantes.', 'error');
    }
  };

  const statsPanel = showStats && hasStats ? <StatsPanel stats={stats} inline={!shouldRenderVideo} /> : null;

  return (
    <figure
      ref={tileRef}
      className={`video-tile ${tile.local ? 'is-local' : ''} ${isFullscreen ? 'is-fullscreen' : ''} ${isCinema ? 'is-cinema' : ''}`}
    >
      {shouldRenderVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={tile.local}
          onDoubleClick={toggleFullscreen}
        />
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            minHeight: '180px',
            padding: '10px 0',
            background: '#0b0d0c',
            color: 'var(--text-dim)',
            fontFamily: 'var(--font-type)',
            fontSize: '13px',
          }}
        >
          <span>Transmissão ativa para o esgoto</span>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => setShowLocalPreview(true)}
          >
            Ver prévia da tela
          </button>
          {statsPanel}
        </div>
      )}
      {shouldRenderVideo && statsPanel}
      <figcaption>
        <span>{tile.label}</span>
        <span className="video-actions">
          {tile.local && showLocalPreview && (
            <button
              type="button"
              className="link-button"
              onClick={() => setShowLocalPreview(false)}
            >
              Ocultar prévia
            </button>
          )}
          {hasAudio && shouldRenderVideo && (
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              style={{ width: '80px', cursor: 'pointer', accentColor: 'var(--brass)' }}
              title={`Volume da transmissão: ${Math.round(volume * 100)}%`}
              aria-label="Volume da transmissão"
            />
          )}
          {hasStats && (
            <button
              type="button"
              className={`link-button ${showStats ? 'is-active' : ''}`}
              onClick={() => setShowStats((open) => !open)}
              aria-pressed={showStats}
              title="Monitor de desempenho: bitrate, FPS, resolução, codec e ping"
            >
              Stats
            </button>
          )}
          {shouldRenderVideo && pipSupported && (
            <button
              type="button"
              className={`link-button ${isPip ? 'is-active' : ''}`}
              onClick={togglePip}
              aria-pressed={isPip}
              title="Assistir em uma janela flutuante sobre outros aplicativos"
            >
              {isPip ? 'Sair do PiP' : 'PiP'}
            </button>
          )}
          {shouldRenderVideo && canCinema && (
            <button
              type="button"
              className={`link-button ${isCinema ? 'is-active' : ''}`}
              onClick={onToggleCinema}
              aria-pressed={isCinema}
              title="Expandir a transmissão pela área central (Esc para sair)"
            >
              {isCinema ? 'Sair do Cinema' : 'Modo Cinema'}
            </button>
          )}
          {shouldRenderVideo && (
            <button type="button" className="link-button" onClick={toggleFullscreen}>
              {isFullscreen ? 'Sair da Tela Cheia' : 'Tela cheia'}
            </button>
          )}
          {tile.local && (
            <button type="button" className="btn btn-danger btn-small" onClick={tile.onStop}>
              Parar Transmissão
            </button>
          )}
        </span>
      </figcaption>
    </figure>
  );
}

export default function VideoGrid({ tiles, cinemaId = null, onCinemaChange, cinemaAvailable = false }) {
  if (tiles.length === 0) return null;

  const cinemaTileId = tiles.some((t) => t.id === cinemaId) ? cinemaId : null;
  const canCinema = cinemaAvailable && typeof onCinemaChange === 'function';

  return (
    <div className="video-grid" data-count={tiles.length} aria-label="Transmissões de tela">
      {tiles.map((tile) => (
        <VideoTile
          key={tile.id}
          tile={tile}
          isCinema={cinemaTileId === tile.id}
          canCinema={canCinema}
          onToggleCinema={() => onCinemaChange?.(cinemaTileId === tile.id ? null : tile.id)}
        />
      ))}
    </div>
  );
}