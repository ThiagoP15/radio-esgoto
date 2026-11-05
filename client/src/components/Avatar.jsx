import { assetUrl } from '../api.js';
import { sprite } from '../assets/index.js';

const BASES = ['base-neutro', 'base-oliva', 'base-roxo'];

function baseFor(name) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return BASES[hash % BASES.length];
}

// Foto (ou inicial sobre base colorida) recortada em octógono, com a moldura de latão por cima.
export default function Avatar({ name, src, size = 40 }) {
  const frame = sprite('moldura-octogonal');
  const base = sprite(baseFor(name));
  return (
    <span className="avatar" style={{ width: size, height: size }} aria-hidden="true">
      {src ? (
        <img className="avatar-img" src={assetUrl(src)} alt="" />
      ) : (
        <span className="avatar-img avatar-fallback" style={{ backgroundImage: `url(${base.src})`, fontSize: size * 0.42 }}>
          {name.charAt(0).toUpperCase()}
        </span>
      )}
      <img className="avatar-frame" src={frame.src} srcSet={frame.srcSet} alt="" />
    </span>
  );
}
