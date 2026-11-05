import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverUrl = (env.VITE_SERVER_URL || 'http://localhost:3001').replace(/\/$/, '');
  const wsUrl = serverUrl.replace(/^http/, 'ws');

  // CSP só no build: em dev o plugin do React injeta um script inline.
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${serverUrl}`,
    "media-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${serverUrl} ${wsUrl}`,
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');

  return {
    base: './',
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
    build: { outDir: 'dist', emptyOutDir: true },
  };
});
