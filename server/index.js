'use strict';

const http = require('node:http');
const cors = require('cors');
const express = require('express');
const multer = require('multer');

const config = require('./src/config');
const { router: authRouter } = require('./src/auth');
const { createAdminRouter } = require('./src/admin');
const { createUploadsRouter, uploadsStatic } = require('./src/uploads');
const messagesRouter = require('./src/messages');
const { createSocketServer } = require('./src/socket');
const { securityHeaders, httpsOnly, csrfGuard, globalLimiter } = require('./src/security');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy); // atrás do Caddy/Nginx: IP real do cliente e req.secure corretos

app.use(httpsOnly);
app.use(securityHeaders());
app.use(
  cors({
    origin: config.allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Requested-With'],
    maxAge: 600,
  }),
);
app.use(globalLimiter);
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use(csrfGuard);
app.use(express.json({ limit: '16kb' }));

const server = http.createServer(app);
const realtime = createSocketServer(server);

app.use(authRouter); // /register, /login, /logout, /me
app.use(createUploadsRouter({ onUserChanged: realtime.broadcastUserUpdate })); // /upload, /users/avatar
app.use(messagesRouter); // /channels, /messages/:channelId
app.use('/admin', createAdminRouter({ realtime }));
app.use('/uploads', uploadsStatic());

app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'Arquivo grande demais.' : 'Upload inválido.' });
  }
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(err.status || 400).json({ error: 'Requisição inválida.' });
  }
  console.error('[erro]', err); // detalhes só no log do servidor, nunca na resposta
  return res.status(500).json({ error: 'Erro interno.' });
});

server.listen(config.port, () => {
  console.log(`[Rádio Esgoto] servidor na porta ${config.port} (${config.isProd ? 'produção' : 'desenvolvimento'})`);
});

function shutdown() {
  realtime.io.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
