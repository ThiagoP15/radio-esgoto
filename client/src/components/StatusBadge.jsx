import { COPY } from '../copy.js';
import { sprite } from '../assets/index.js';

export const STATUS_LABEL = COPY.status;

// Opções do menu do próprio usuário ("Invisível" = aparece offline para os outros).
export const STATUS_OPTIONS = [
  { id: 'online', label: COPY.status.online },
  { id: 'away', label: COPY.status.away },
  { id: 'dnd', label: COPY.status.dnd },
  { id: 'offline', label: 'Invisível' },
];

// Lâmpadas do kit: online = âmbar brilhante, ausente = lua, ocupado = vermelha, offline = apagada.
const LAMP = { online: 'online', away: 'ausente', dnd: 'ocupado', offline: 'offline' };

export default function StatusBadge({ status, size = 12 }) {
  const { src, srcSet } = sprite(LAMP[status] ?? 'offline');
  return (
    <img
      className={`lamp lamp-${status}`}
      src={src}
      srcSet={srcSet}
      width={size}
      height={size}
      role="img"
      alt={STATUS_LABEL[status] ?? STATUS_LABEL.offline}
    />
  );
}
