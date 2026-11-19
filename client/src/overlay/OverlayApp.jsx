import { useEffect, useState } from 'react';
import Avatar from '../components/Avatar.jsx';
import './overlay.css';

const normalize = (state) => ({
  side: state?.side === 'right' ? 'right' : 'left',
  participants: state?.participants ?? [],
});

// Rota #/overlay: roda na janela transparente do overlay. Não faz login, não abre socket e não carrega o App.
// Só desenha o que a janela principal manda por IPC: [{ id, name, avatar, speaking }].
export default function OverlayApp() {
  const [state, setState] = useState(() => normalize(null));

  useEffect(() => {
    const api = window.radioEsgoto?.overlay;
    if (!api) return undefined;

    let cancelled = false;
    // O overlay pode abrir depois da primeira atualização: pega o último estado conhecido.
    api
      .getState()
      .then((initial) => {
        if (!cancelled && initial) setState(normalize(initial));
      })
      .catch(() => {});
    const off = api.onState((next) => setState(normalize(next)));

    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  return (
    <ul className="overlay-list" data-side={state.side} aria-hidden="true">
      {state.participants.map((p) => (
        <li key={p.id} className={`overlay-item ${p.speaking ? 'is-speaking' : ''}`}>
          <div className="overlay-avatar">
            <Avatar name={p.name} src={p.avatar} size={44} />
          </div>
          <span className="overlay-name">{p.name}</span>
        </li>
      ))}
    </ul>
  );
}
