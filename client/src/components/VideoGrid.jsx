import { useEffect, useRef, useState } from 'react';

function VideoTile({ tile }) {
  const tileRef = useRef(null);
  const videoRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Se for a sua própria tela (local), começa com o preview pausado para não criar espelho infinito nem bugar o driver
  const [showLocalPreview, setShowLocalPreview] = useState(false);

  const shouldRenderVideo = !tile.local || showLocalPreview;

  useEffect(() => {
    const video = videoRef.current;
    if (video && shouldRenderVideo) {
      video.srcObject = tile.stream;
    }
    return () => {
      if (video) video.srcObject = null;
    };
  }, [tile.stream, shouldRenderVideo]);

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