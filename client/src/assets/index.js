// Sprites e imagens do tema. Os PNGs pequenos têm versão @2x: <img srcSet> escolhe sozinho pela densidade da tela.
const files = import.meta.glob('./ui/**/*.png', { eager: true, query: '?url', import: 'default' });
const byName = {};
for (const [path, url] of Object.entries(files)) byName[path.match(/\/([^/]+)\.png$/)[1]] = url;

export function sprite(name) {
  const x2 = byName[`${name}@2x`];
  return { src: byName[name], srcSet: x2 ? `${byName[name]} 1x, ${x2} 2x` : undefined };
}

export const brand = {
  logo: new URL('./brand/logo-radio-esgoto.webp', import.meta.url).href,
  icon: new URL('./brand/icone-128.webp', import.meta.url).href,
  empty: new URL('./art/estado-vazio.webp', import.meta.url).href,
};
