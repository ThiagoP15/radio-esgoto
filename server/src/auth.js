'use strict';

const bcrypt = require('bcrypt');
const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('./config');
const { stmts, toPublicUser } = require('./db');
const { rest } = require('./schemas');
const { validate, loginLimiter, registerLimiter } = require('./security');

const BCRYPT_COST = 12;
// Hash falso: o login gasta o mesmo tempo com usuário inexistente (evita enumeração por timing).
const DUMMY_HASH = bcrypt.hashSync('radio-esgoto-dummy-password', BCRYPT_COST);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    try {
      cookies[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      /* cookie malformado: ignora */
    }
  }
  return cookies;
}

// --- Sessão: JWT em cookie HttpOnly (o JavaScript do app nunca enxerga o token) -------------
const cookieOptions = () => ({
  httpOnly: true,
  secure: config.cookie.secure,
  sameSite: config.cookie.sameSite,
  path: '/',
});

function signToken(user) {
  return jwt.sign({}, config.jwtSecret, {
    algorithm: 'HS256',
    subject: String(user.id),
    expiresIn: config.jwtExpiresIn,
  });
}

/** Valida o JWT e devolve o usuário ATUAL do banco: role e status nunca vêm do token. */
function verifyToken(token) {
  const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  const user = stmts.userById.get(Number(payload.sub));
  if (!user || user.status !== 'approved') throw new Error('Sessão não autorizada.');
  return user;
}

const userFromCookieHeader = (header) => verifyToken(parseCookies(header)[config.cookie.name] ?? '');

function requireAuth(req, res, next) {
  try {
    req.user = userFromCookieHeader(req.headers.cookie);
    return next();
  } catch {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }
}

/** Middleware isAdmin: decodifica o JWT (requireAuth) e exige role 'admin' no banco. */
const isAdmin = [
  requireAuth,
  (req, res, next) =>
    req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Acesso restrito a administradores.' }),
];

// --- Bloqueio progressivo contra força bruta (além do rate limit por IP) --------------------
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const failures = new Map(); // usuário (minúsculo) -> { count, until }
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of failures) if (entry.until <= now && entry.count < MAX_FAILURES) failures.delete(key);
}, 10 * 60 * 1000).unref();

const isLocked = (key) => (failures.get(key)?.until ?? 0) > Date.now() && failures.get(key).count >= MAX_FAILURES;
function recordFailure(key) {
  const entry = failures.get(key) ?? { count: 0, until: 0 };
  entry.count += 1;
  entry.until = Date.now() + LOCK_MS;
  failures.set(key, entry);
}

const router = express.Router();

router.post(
  '/register',
  registerLimiter,
  validate(rest.register),
  wrap(async (req, res) => {
    const { username, password } = req.valid.body; // só estes dois campos: role e status nunca vêm do cliente
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    try {
      stmts.insertUser.run(username, hash); // sempre role 'user' e status 'pending'
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'Esse nome de usuário já existe.' });
      }
      throw err;
    }
    return res.status(201).json({ status: 'pending' });
  }),
);

router.post(
  '/login',
  loginLimiter,
  validate(rest.login),
  wrap(async (req, res) => {
    const { username, password } = req.valid.body;
    const key = username.toLowerCase();
    if (isLocked(key)) return res.status(429).json({ error: 'Muitas tentativas. Tente novamente mais tarde.' });

    const user = stmts.userByUsername.get(username);
    const ok = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
    if (!user || !ok) {
      recordFailure(key);
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    }
    failures.delete(key);

    // O status só é revelado a quem acertou a senha; o JWT só é emitido para contas aprovadas.
    if (user.status === 'pending') return res.status(403).json({ code: 'PENDING', error: 'Aguardando aprovação' });
    if (user.status !== 'approved') return res.status(403).json({ code: 'REJECTED', error: 'Acesso negado.' });

    res.cookie(config.cookie.name, signToken(user), { ...cookieOptions(), maxAge: config.cookie.maxAgeMs });
    return res.json({ user: toPublicUser(user) });
  }),
);

router.post('/logout', (_req, res) => {
  res.clearCookie(config.cookie.name, cookieOptions());
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => res.json(toPublicUser(req.user)));

module.exports = { router, requireAuth, isAdmin, verifyToken, userFromCookieHeader, parseCookies, wrap };
