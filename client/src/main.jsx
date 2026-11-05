import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/special-elite/400.css';
import App from './App.jsx';
import { initFx } from './fx.js';
import './tailwind.css';
import './styles.css';

initFx();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
