// Efeitos visuais (vinheta, grão, flicker, névoa): ligados por padrão, desligáveis pelo menu do usuário.
// Com prefers-reduced-motion o CSS já desliga grão, flicker e animações, mesmo com os efeitos ligados.
const KEY = 'radioesgoto.fx';
export const getFx = () => localStorage.getItem(KEY) !== 'off';
export function setFx(enabled) {
  localStorage.setItem(KEY, enabled ? 'on' : 'off');
  document.documentElement.dataset.fx = enabled ? 'on' : 'off';
}
export const initFx = () => {
  document.documentElement.dataset.fx = getFx() ? 'on' : 'off';
};
