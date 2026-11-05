import { useEffect } from 'react';

/**
 * Fecha um popover ao clicar fora, apertar Esc ou rolar a página.
 * Elementos com `data-overlay-trigger` (o botão que abre o popover) não contam como "fora":
 * quem abre trata o próprio clique.
 */
export function useDismiss(ref, onClose) {
  useEffect(() => {
    const onPointerDown = (event) => {
      if (ref.current?.contains(event.target)) return;
      if (event.target.closest?.('[data-overlay-trigger]')) return;
      onClose();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    const onScroll = (event) => {
      if (!ref.current?.contains(event.target)) onClose();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [ref, onClose]);
}
