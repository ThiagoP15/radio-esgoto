import { io } from 'socket.io-client';
import { SERVER_URL } from './api.js';

const STATUS_KEY = 'radioesgoto.status';
export const getStoredStatus = () => localStorage.getItem(STATUS_KEY) || 'online';
export const setStoredStatus = (status) => localStorage.setItem(STATUS_KEY, status);

// A sessão vai no cookie HttpOnly (withCredentials). O último status escolhido vai no handshake
// para o "Não perturbe" não voltar a "Online" ao reconectar.
export const socket = io(SERVER_URL, {
  autoConnect: false,
  withCredentials: true,
  auth: (cb) => cb({ status: getStoredStatus() }),
  reconnectionDelayMax: 5000,
});
