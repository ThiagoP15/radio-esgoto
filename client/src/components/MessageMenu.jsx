import { useRef, useState } from 'react';
import { useDismiss } from '../hooks/useDismiss.js';

const WIDTH = 190;
const HEIGHT = 110;

// Menu de contexto da mensagem. Editar: só o autor. Excluir: autor ou administrador (moderação).
export default function MessageMenu({ anchor, canEdit, moderating, onEdit, onDelete, onClose }) {
  const ref = useRef(null);
  const [confirming, setConfirming] = useState(false);
  useDismiss(ref, onClose);

  const left = Math.max(8, Math.min(anchor.x - WIDTH, window.innerWidth - WIDTH - 8));
  const fitsBelow = anchor.bottom + 6 + HEIGHT <= window.innerHeight - 8;
  const top = fitsBelow ? anchor.bottom + 6 : Math.max(8, anchor.top - 6 - HEIGHT);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Ações da mensagem"
      className="menu-panel fixed z-30 p-1.5"
      style={{ left, top, width: WIDTH }}
    >
      {confirming ? (
        <>
          <p className="px-2 py-1 text-sm">
            {moderating ? 'Tem certeza que deseja apagar esta mensagem como moderador?' : 'Excluir esta mensagem?'}
          </p>
          <button type="button" role="menuitem" autoFocus onClick={onDelete} className="menu-item menu-item-danger w-full px-2 py-1.5 text-left text-sm">
            {moderating ? 'Apagar como moderador' : 'Excluir'}
          </button>
          <button type="button" role="menuitem" onClick={() => setConfirming(false)} className="menu-item mt-1 w-full px-2 py-1.5 text-left text-sm">
            Cancelar
          </button>
        </>
      ) : (
        <>
          {canEdit && (
            <button type="button" role="menuitem" onClick={onEdit} className="menu-item w-full px-2 py-1.5 text-left text-sm">
              Editar
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => setConfirming(true)}
            className="menu-item menu-item-danger-text w-full px-2 py-1.5 text-left text-sm"
          >
            {moderating ? 'Excluir (moderação)' : 'Excluir'}
          </button>
        </>
      )}
    </div>
  );
}
