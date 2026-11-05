'use strict';

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');

const tooMany = { error: 'Muitas requisições. Tente novamente em alguns minutos.' };
const limiter = (options) =>
  rateLimit({ standardHeaders: 'draft-7', legacyHeaders: false, message: tooMany, ...options });

// Headers de segurança. A API só serve JSON e arquivos: CSP restritiva, sem frames, HSTS em produção.
const securityHeaders = () =>
  helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // avatares e anexos são carregados pelo app (outra origem)
    hsts: config.isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
  });

/** Em produção, tudo que não for HTTPS é redirecionado (GET) ou recusado. /health fica de fora (healthcheck interno). */
function httpsOnly(req, res, next) {
  if (!config.forceHttps || req.secure || req.path === '/health') return next();
  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.redirect(308, `https://${config.publicHost || req.hostname}${req.originalUrl}`);
  }
  return res.status(400).json({ error: 'HTTPS obrigatório.' });
}

/**
 * Proteção contra CSRF para requisições que alteram dados (o cookie de sessão vai junto sozinho):
 * a origem precisa estar na lista e o cabeçalho X-Requested-With é obrigatório. Esse cabeçalho
 * personalizado força o navegador a fazer preflight CORS, que só passa para origens autorizadas.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
function csrfGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const { origin } = req.headers;
  if (origin && !config.allowedOrigins.includes(origin)) return res.status(403).json({ error: 'Origem não autorizada.' });
  if (req.headers['x-requested-with'] !== 'RadioEsgoto') return res.status(403).json({ error: 'Requisição não autorizada.' });
  return next();
}

/** Valida req[source] com um schema Zod; o resultado já limpo fica em req.valid[source]. */
const validate =
  (schema, source = 'body') =>
  (req, res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      return res.status(400).json({ error: result.error.issues[0]?.message || 'Dados inválidos.' });
    }
    req.valid = { ...req.valid, [source]: result.data };
    return next();
  };

const globalLimiter = limiter({ windowMs: 60 * 1000, limit: 300 });
const loginLimiter = limiter({ windowMs: 15 * 60 * 1000, limit: 15, skipSuccessfulRequests: true });
const registerLimiter = limiter({ windowMs: 60 * 60 * 1000, limit: 8 });
const uploadLimiter = limiter({ windowMs: 10 * 60 * 1000, limit: 40 });

module.exports = {
  securityHeaders,
  httpsOnly,
  csrfGuard,
  validate,
  globalLimiter,
  loginLimiter,
  registerLimiter,
  uploadLimiter,
};
