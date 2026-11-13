import { useEffect, useRef, useState } from 'react';

function VideoTile({ tile }) {
  const tileRef = useRef(null);
  const videoRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Se for a sua própria tela (local), começa com o preview pausado para não criar espelho infinito nem bugar o driver
  const [showLocalPreview, setShowLocalPreview] = useState(false);

  // Volume do som do compartilhamento (só tiles remotos; o local fica sempre mudo).
  const [volume, setVolume] = useState(1);
  const [hasAudio, setHasAudio] = useState(
    () => !tile.local && (tile.stream?.getAudioTracks().length ?? 0) > 0,
  );

  const shouldRenderVideo = !tile.local || showLocalPreview;

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

  return (
    <figure
      ref={tileRef}
      className={`video-tile ${tile.local ? 'is-local' : ''} ${isFullscreen ? 'is-fullscreen' : ''}`}
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
            height: '180px',
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
        </div>
      )}
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

export default function VideoGrid({ tiles }) {
  if (tiles.length === 0) return null;
  return (
    <div className="video-grid" data-count={tiles.length} aria-label="Transmissões de tela">
      {tiles.map((tile) => (
        <VideoTile key={tile.id} tile={tile} />
      ))}
    </div>
  );
}