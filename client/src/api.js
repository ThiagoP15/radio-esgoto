export const SERVER_URL = (import.meta.env.VITE_SERVER_URL || 'http://localhost:3001').replace(/\/$/, '');

/** O servidor guarda caminhos relativos (/uploads/...); aqui viram URLs completas. */
export const assetUrl = (path) => (path ? `${SERVER_URL}${path}` : null);

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * A sessão é um cookie HttpOnly: o JavaScript do app nunca vê o token (credentials: 'include').
 * O cabeçalho X-Requested-With é exigido pelo servidor como proteção contra CSRF.
 */
export async function api(path, { method = 'GET', json, form } = {}) {
  const headers = { 'X-Requested-With': 'RadioEsgoto' };
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form; // o navegador define o Content-Type com o boundary
  }

  let res;
  try {
    res = await fetch(`${SERVER_URL}${path}`, { method, headers, body, credentials: 'include' });
  } catch {
    throw new ApiError('Servidor indisponível.', 0);
  }

  const data = await res.json().catch(() => null); // 204 não tem corpo
  if (!res.ok) {
    if (res.status === 401 && path !== '/me' && path !== '/login') window.dispatchEvent(new Event('auth:expired'));
    throw new ApiError(data?.error ?? 'Erro inesperado.', res.status, data?.code);
  }
  return data;
}
