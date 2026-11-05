import { useRef } from 'react';
import EmojiPicker from 'emoji-picker-react';
import { useDismiss } from '../hooks/useDismiss.js';

const WIDTH = 320;
const HEIGHT = 380;

// Posiciona perto do botão, virando para cima se faltar espaço embaixo.
export default function ReactionPicker({ anchor, onPick, onClose }) {
  const ref = useRef(null);
  useDismiss(ref, onClose);

  const left = Math.max(8, Math.min(anchor.x - WIDTH, window.innerWidth - WIDTH - 8));
  const fitsBelow = anchor.bottom + 6 + HEIGHT <= window.innerHeight - 8;
  const top = fitsBelow ? anchor.bottom + 6 : Math.max(8, anchor.top - 6 - HEIGHT);

  return (
    <div ref={ref} className="menu-panel fixed z-30" style={{ left, top }}>
      <EmojiPicker
        onEmojiClick={(data) => onPick(data.emoji)}
        theme="dark"
        emojiStyle="native" // usa as fontes do sistema: sem baixar imagens de CDN (CSP e rede interna)
        width={WIDTH}
        height={HEIGHT}
        lazyLoadEmojis
        autoFocusSearch
        searchPlaceHolder="Buscar emoji"
        previewConfig={{ showPreview: false }}
      />
    </div>
  );
}
