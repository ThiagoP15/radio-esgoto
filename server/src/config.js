'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ quiet: true });

const isProd = process.env.NODE_ENV === 'production';
const bool = (value, fallback) => (value === undefined || value === '' ? fallback : value === 'true');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const uploadsDir = path.join(dataDir, 'uploads');
const filesDir = path.join(uploadsDir, 'files');
const avatarsDir = path.join(uploadsDir, 'avatars');
for (const dir of [dataDir, filesDir, avatarsDir]) fs.mkdirSync(dir, { recursive: true });

const dbPath = path.join(dataDir, 'database.sqlite');
// Versões antigas guardavam o banco como ratodiscord.db: renomeia (com -wal/-shm) na primeira execução.
const legacyDb = path.join(dataDir, 'ratodiscord.db');
if (!fs.existsSync(dbPath) && fs.existsSync(legacyDb)) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(legacyDb + suffix)) fs.renameSync(legacyDb + suffix, dbPath + suffix);
  }
}

/**
 * Segredo vindo do ambiente. Em produção é obrigatório; em desenvolvimento é gerado uma vez
 * e guardado em data/ (que fica fora do Git) para sobreviver a reinícios.
 */
function loadSecret({ envName, fileName, bytes, validate }) {
  const fromEnv = process.env[envName];
  if (fromEnv) {
    validate(fromEnv);
    return fromEnv;
  }
  if (isProd) throw new Error(`${envName} é obrigatório em produção (veja .env.example).`);

  const file = path.join(dataDir, fileName);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(bytes).toString(envName === 'DATA_ENCRYPTION_KEY' ? 'base64' : 'hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  console.warn(`[config] ${envName} não definido: gerado em ${file} (somente desenvolvimento).`);
  return secret;
}

const jwtSecret = loadSecret({
  envName: 'JWT_SECRET',
  fileName: '.jwt-secret',
  bytes: 48,
  validate: (v) => {
    if (v.length < 32) throw new Error('JWT_SECRET precisa ter pelo menos 32 caracteres.');
  },
});

const dataKey = Buffer.from(
  loadSecret({
    envName: 'DATA_ENCRYPTION_KEY',
    fileName: '.data-key',
    bytes: 32,
    validate: (v) => {
      if (Buffer.from(v, 'base64').length !== 32) throw new Error('DATA_ENCRYPTION_KEY precisa ser 32 bytes em base64.');
    },
  }),
  'base64',
);

// SameSite=None só funciona com Secure; o app empacotado (app://) fala com o servidor entre sites.
const sameSite = (process.env.COOKIE_SAMESITE || (isProd ? 'none' : 'lax')).toLowerCase();

module.exports = {
  isProd,
  port: Number(process.env.PORT) || 3001,
  trustProxy: Number(process.env.TRUST_PROXY ?? (isProd ? 1 : 0)),
  forceHttps: bool(process.env.FORCE_HTTPS, isProd),
  publicHost: process.env.PUBLIC_HOST || '',

  allowedOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,app://radio-esgoto')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  cookie: {
    name: 'res_session',
    sameSite,
    secure: sameSite === 'none' ? true : bool(process.env.COOKIE_SECURE, isProd),
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  },

  dataDir,
  dbPath,
  uploadsDir,
  filesDir,
  avatarsDir,

  jwtSecret,
  jwtExpiresIn: '7d',
  dataKey,

  historyPageSize: 50,
  maxMessageLength: 2000,
  maxVoicePeers: 6, // malha P2P: cada pessoa a mais multiplica as conexões
  maxFileBytes: 25 * 1024 * 1024,
  maxAvatarBytes: 2 * 1024 * 1024,
};
