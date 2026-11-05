// Avisos rápidos: toast('mensagem', 'info' | 'success' | 'error')
export const toast = (message, kind = 'info') =>
  window.dispatchEvent(new CustomEvent('toast', { detail: { message, kind, id: Math.random() } }));
