import { useRef } from 'react';
import { useDismiss } from '../hooks/useDismiss.js';
import StatusBadge, { STATUS_OPTIONS } from './StatusBadge.jsx';

export default function StatusMenu({ status, fxEnabled, onSelect, onChangePhoto, onToggleFx, onClose }) {
  const ref = useRef(null);
  useDismiss(ref, onClose);

  const item = 'menu-item flex w-full items-center gap-3 px-2 py-1.5 text-left text-sm';

  return (
    <div ref={ref} role="menu" aria-label="Status" className="menu-panel absolute bottom-full left-2 z-20 mb-2 w-60 p-1.5">
      <p className="label px-2 pb-1 pt-1">Status</p>
      {STATUS_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          role="menuitemradio"
          aria-checked={option.id === status}
          onClick={() => onSelect(option.id)}
          className={`${item} ${option.id === status ? 'is-selected' : ''}`}
        >
          <StatusBadge status={option.id} size={14} />
          {option.label}
        </button>
      ))}
      <div className="menu-sep my-1" />
      <button type="button" role="menuitem" onClick={onChangePhoto} className={item}>
        Alterar foto de perfil
      </button>
      <button type="button" role="menuitemcheckbox" aria-checked={fxEnabled} onClick={onToggleFx} className={item}>
        Efeitos visuais: {fxEnabled ? 'ligados' : 'desligados'}
      </button>
    </div>
  );
}
