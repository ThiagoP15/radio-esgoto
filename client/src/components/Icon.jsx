import { sprite } from '../assets/index.js';

// Ícones de latão do kit (canal-texto, canal-voz, microfone, sair...). Decorativos: o texto vem do botão.
export default function Icon({ name, size = 20, className = '' }) {
  const { src, srcSet } = sprite(name);
  return <img className={`icon ${className}`} src={src} srcSet={srcSet} width={size} height={size} alt="" aria-hidden="true" />;
}
