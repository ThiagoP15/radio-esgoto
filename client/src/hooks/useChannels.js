import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { socket } from '../socket.js';

/**
 * Categorias e canais do servidor. Quando um administrador cria, edita ou exclui algo, o servidor emite
 * `server-structure-changed` e a lista é buscada de novo: a barra lateral muda na hora para todo mundo.
 */
export function useChannels(connected) {
  const [categories, setCategories] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(
    () =>
      api('/channels')
        .then((data) => {
          setCategories(data.categories);
          setLoaded(true);
        })
        .catch(() => {}),
    [],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (connected) reload(); // ao reconectar, pode ter havido mudanças enquanto estava fora
  }, [connected, reload]);

  useEffect(() => {
    socket.on('server-structure-changed', reload);
    return () => socket.off('server-structure-changed', reload);
  }, [reload]);

  return { categories, loaded, reload };
}
