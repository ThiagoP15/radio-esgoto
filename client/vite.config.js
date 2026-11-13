import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverUrl = (env.VITE_SERVER_URL || 'https://radio-esgoto.duckdns.org').replace(/\/$/, '');
  const wsUrl = serverUrl.replace(/^http/, 'ws');

  // CSP só no build: inclui data: e blob: em script-src e worker-src para liberar o AudioWorklet
  const csp = [
    "default-src 'self'",
    "script-src 'self' data: blob:",
    "worker-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${serverUrl}`,
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${serverUrl} ${wsUrl}`,
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');

  return {
    base: '/',
    plugins: [
      react(),
      {
        name: 'radio-esgoto-inject-csp',
        transformIndexHtml(html, ctx) {
          if (ctx.server) return html;
          return html.replace(
            '<!--CSP-->',
            `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
          );
        },
      },
    ],
    server: { port: 5173, strictPort: true },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      assetsInlineLimit: 0, // Mantém o screen-audio-worklet.js como arquivo separado em vez de Base64
    },
  };
});