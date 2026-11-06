import { useEffect, useRef, useState } from 'react';
import { socket } from '../socket.js';
import { VoiceSession } from '../voice/VoiceSession.js';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import ScreenPicker from './ScreenPicker.jsx';
import VideoGrid from './VideoGrid.jsx';

// STUN público por padrão (necessário para pessoas atrás de NAT, ex.: servidor na nuvem). Troque por STUN/TURN
// próprio em VITE_ICE_SERVERS (JSON). "[]" desliga e limita as chamadas à rede local.
const DEFAULT_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
function readIceServers() {
  const raw = import.meta.env.VITE_ICE_SERVERS;
  if (!raw) return DEFAULT_ICE;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_ICE;
  } catch {
    return DEFAULT_ICE;
  }
}
const ICE_SERVERS = readIceServers();

function explain(err) {
  if (err?.name === 'NotAllowedError') return 'Permissão negada (microfone ou compartilhamento de tela).';
  if (err?.name === 'NotFoundError') return 'Nenhum microfone encontrado.';
  return err?.message || 'Algo deu errado na chamada.';
}

// <audio> invisível atualizado para receber e aplicar o controle de volume
function RemoteAudio({ stream, volume }) {
  const ref = useRef(null);
  
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (ref.current && volume !== undefined) {
      ref.current.volume = volume;
    }
  }, [volume]);

  return <audio ref={ref} autoPlay />;
}

export default function VoiceChannel({ channel, user, hidden, onLeave, onToggleNav }) {
  const [state, setState] = useState({ peers: [], sharing: false, screenStream: null, noiseSuppression: true });
  const [status, setStatus] = useState('connecting'); // connecting | connected | error
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [sources, setSources] = useState(null);
  const sessionRef = useRef(null);

  // Novos estados para volume individual e ocultar telas
  const [volumes, setVolumes] = useState({});
  const [hiddenScreens, setHiddenScreens] = useState({});

  useEffect(() => {
    const session = new VoiceSession({ socket, channelId: channel.id, iceServers: ICE_SERVERS, onUpdate: setState });
    sessionRef.current = session;
    let cancelled = false;

    session
      .start()
      .then(() => {
        if (!cancelled) setStatus('connected');
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus('error');
        setError(explain(err));
      });

    return () => {
      cancelled = true;
      session.stop();
    };
  }, [channel.id]);

  const toggleMute = () => {
    sessionRef.current?.setMuted(!muted);
    setMuted(!muted);
  };

  const toggleNoise = async () => {
    try {
      await sessionRef.current.setNoiseSuppression(!state.noiseSuppression);
    } catch (err) {
      setError(explain(err));
    }
  };

  const startShare = async () => {
    setError('');
    try {
      await sessionRef.current.startScreenShare();
    } catch (err) {
      if (err?.name !== 'NotAllowedError') setError(explain(err));
    }
  };

  const toggleScreen = async () => {
    if (state.sharing) return sessionRef.current.stopScreenShare();
    const bridge = window.radioEsgoto;
    if (bridge?.getScreenSources) {
      try {
        setSources(await bridge.getScreenSources()); 
      } catch (err) {
        setError(explain(err));
      }
      return undefined;
    }
    return startShare(); 
  };

  const pickSource = async (id) => {
    setSources(null);
    if (!id) return;
    await window.radioEsgoto.selectScreenSource(id);
    await startShare();
  };

  // As telas que estiverem marcadas como "hidden" são filtradas e não aparecem no VideoGrid
  const tiles = [
    ...(state.screenStream
      ? [{ id: 'local', stream: state.screenStream, label: 'Sua tela', local: true, onStop: () => sessionRef.current?.stopScreenShare() }]
      : []),
    ...state.peers
      .filter((p) => p.screenStream && !hiddenScreens[p.id])
      .map((p) => ({ id: p.id, stream: p.screenStream, label: `Tela de ${p.user.username}`, local: false })),
  ];

  return (
    <>
      <VideoGrid tiles={tiles} />

      <section className="voice" hidden={hidden}>
        <header className="chat-header">
          <button type="button" className="menu-toggle" onClick={onToggleNav} aria-label="Abrir lista de canais">
            <Icon name="menu" size={22} />
          </button>
          <Icon name="canal-voz" size={22} />
          <h2 className="display">{channel.name}</h2>
          <span className="voice-status">
            {status === 'connecting' && 'Conectando…'}
            {status === 'connected' && 'Conectado'}
            {status === 'error' && 'Falha na conexão'}
          </span>
        </header>

        <div className="voice-body">
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}

          {/* Painel Compacto de Participantes com Controles de Volume e Tela */}
          <ul className="participants" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Avatar name={user.username} src={user.avatar_url} size={40} />
              <span>
                {user.username} (você){muted ? ' · mudo' : ''}
              </span>
            </li>
            {state.peers.map((peer) => (
              <li key={peer.id} style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: '150px' }}>
                  <Avatar name={peer.user.username} src={peer.user.avatar_url} size={40} />
                  <span>{peer.user.username}</span>
                </div>

                {/* Controle de Volume */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Icon name="microfone" size={16} />
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={volumes[peer.id] ?? 1}
                    onChange={(e) => setVolumes(prev => ({ ...prev, [peer.id]: parseFloat(e.target.value) }))}
                    style={{ width: '80px', cursor: 'pointer' }}
                    title="Ajustar volume"
                  />
                </div>

                {/* Botão para ocultar/mostrar transmissão individual */}
                {peer.screenStream && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '4px 10px', fontSize: '12px', minHeight: 'auto' }}
                    onClick={() => setHiddenScreens(prev => ({ ...prev, [peer.id]: !prev[peer.id] }))}
                  >
                    {hiddenScreens[peer.id] ? 'Mostrar Tela' : 'Ocultar Tela'}
                  </button>
                )}
              </li>
            ))}
          </ul>

          {/* Aplicação do volume modificado nos elementos de áudio */}
          {state.peers.map((peer) => peer.audioStream && <RemoteAudio key={peer.id} stream={peer.audioStream} volume={volumes[peer.id] ?? 1} />)}
        </div>

        <footer className="voice-controls">
          <button type="button" className="btn btn-secondary" onClick={toggleMute} disabled={status !== 'connected'}>
            <Icon name={muted ? 'microfone-mudo' : 'microfone'} size={18} />
            {muted ? 'Ativar microfone' : 'Silenciar microfone'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={toggleNoise}
            disabled={status !== 'connected'}
            aria-pressed={state.noiseSuppression}
            title="Supressão de ruído, cancelamento de eco e ganho automático"
          >
            Supressão de ruído: {state.noiseSuppression ? 'ligada' : 'desligada'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={toggleScreen} disabled={status !== 'connected'}>
            {state.sharing ? 'Parar Transmissão' : 'Compartilhar Tela'}
          </button>
          <button type="button" className="btn btn-danger" onClick={onLeave}>
            Sair da chamada
          </button>
        </footer>

        {sources && <ScreenPicker sources={sources} onPick={pickSource} />}
      </section>
    </>
  );
}