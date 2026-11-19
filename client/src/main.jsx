import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/special-elite/400.css';
import App from './App.jsx';
import OverlayApp from './overlay/OverlayApp.jsx';
import { initFx } from './fx.js';
import './tailwind.css';
import './styles.css';

initFx();

// A janela do overlay para jogos carrega este mesmo bundle em #/overlay: nela NÃO sobe o App
// (sem login, sem socket, sem efeitos), só os avatares. A classe deixa o fundo transparente.
const isOverlayRoute = window.location.hash.startsWith('#/overlay');
if (isOverlayRoute) document.documentElement.classList.add('is-overlay');

createRoot(document.getElementById('root')).render(
  <StrictMode>{isOverlayRoute ? <OverlayApp /> : <App />}</StrictMode>,
);
