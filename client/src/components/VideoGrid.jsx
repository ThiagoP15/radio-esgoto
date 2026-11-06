import { useEffect, useRef, useState } from 'react';

function VideoTile({ tile }) {
  const tileRef = useRef(null); // Referência para a caixa inteira
  const videoRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Liga o vídeo à stream
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.srcObject = tile.stream;
    return () => {
      if (video) video.srcObject = null;
    };
  }, [tile.stream]);

  // Deteta se o utilizador entrou ou saiu da tela cheia (mesmo carregando na tecla ESC)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === tileRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    const container = tileRef.current;
    if (!container) return;

    try {
      if (!document.fullscreenElement) {
        // Coloca a CAIXA inteira em tela cheia, não apenas o vídeo
        await container.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error(`Erro ao tentar alterar tela cheia: ${err.message}`);
    }
  };

  return (
    <figure ref={tileRef} className={`video-tile ${tile.local ? 'is-local' : ''}`}>
      <video ref={videoRef} autoPlay playsInline muted={tile.local} />
      <figcaption>
        <span>{tile.label}</span>
        <span className="video-actions">
          <button type="button" className="link-button" onClick={toggleFullscreen}>
            {isFullscreen ? 'Sair da Tela Cheia' : 'Tela cheia'}
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