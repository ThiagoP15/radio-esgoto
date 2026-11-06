import { useEffect, useRef } from 'react';

function VideoTile({ tile }) {
  const videoRef = useRef(null);

  // O <video> é criado quando a transmissão aparece e desmontado quando ela some.
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.srcObject = tile.stream;
    return () => {
      if (video) video.srcObject = null;
    };
  }, [tile.stream]);

  // Função robusta para alternar entre entrar e sair da tela cheia
  const toggleFullscreen = async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      if (!document.fullscreenElement) {
        await video.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error(`Erro ao tentar alterar tela cheia: ${err.message}`);
    }
  };

  return (
    <figure className={`video-tile ${tile.local ? 'is-local' : ''}`}>
      {/* A prévia local é muda (senão o áudio da própria tela volta em eco) */}
      <video ref={videoRef} autoPlay playsInline muted={tile.local} />
      <figcaption>
        <span>{tile.label}</span>
        <span className="video-actions">
          <button type="button" className="link-button" onClick={toggleFullscreen}>
            Tela cheia
          </button>
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

// Transmissões ativas da chamada: a sua (local) e as dos outros (remotas).
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