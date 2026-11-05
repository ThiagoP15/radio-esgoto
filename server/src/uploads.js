'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const { stmts, toPublicUser } = require('./db');
const { requireAuth } = require('./auth');
const { sniffFile } = require('./filetype');
const { uploadLimiter } = require('./security');

const INLINE_EXT = new Set(['.png', '.jpg', '.gif', '.webp']);

const removeFile = (filePath) => fs.unlink(filePath, () => {});

// O arquivo é gravado com nome aleatório e SEM extensão útil; a extensão final vem do conteúdo real.
const makeUpload = (dir, maxBytes) =>
  multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.part`),
    }),
    limits: { fileSize: maxBytes, files: 1, fields: 0, parts: 2 },
  });

const chatUpload = makeUpload(config.filesDir, config.maxFileBytes);
const avatarUpload = makeUpload(config.avatarsDir, config.maxAvatarBytes);

// O multer lê o nome como latin1; reconverte para UTF-8 e tira caracteres de controle.
const displayName = (original) =>
  Buffer.from(original, 'latin1').toString('utf8').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255);

/** Confere o tipo real e renomeia para <uuid>.<ext>. Em caso de falha apaga o arquivo e devolve null. */
function finalize(file, { imagesOnly }) {
  const type = sniffFile(file.path, file.originalname);
  if (!type || (imagesOnly && !type.isImage)) {
    removeFile(file.path);
    return null;
  }
  const finalName = file.filename.replace(/\.part$/, `.${type.ext}`);
  fs.renameSync(file.path, path.join(path.dirname(file.path), finalName));
  return { filename: finalName, type };
}

function createUploadsRouter({ onUserChanged }) {
  const router = express.Router();

  router.post('/upload', uploadLimiter, requireAuth, chatUpload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const saved = finalize(req.file, { imagesOnly: false });
    if (!saved) return res.status(415).json({ error: 'Tipo de arquivo não permitido.' });
    return res.status(201).json({
      url: `/uploads/files/${saved.filename}`,
      name: displayName(req.file.originalname),
      mime: saved.type.mime,
    });
  });

  router.post('/users/avatar', uploadLimiter, requireAuth, avatarUpload.single('avatar'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
    const saved = finalize(req.file, { imagesOnly: true });
    if (!saved) return res.status(415).json({ error: 'A foto deve ser PNG, JPEG, GIF ou WebP.' });

    const previous = req.user.avatar_url;
    const avatarUrl = `/uploads/avatars/${saved.filename}`;
    stmts.setAvatar.run(avatarUrl, req.user.id); // sempre o usuário da sessão: nunca um id vindo do cliente
    if (previous?.startsWith('/uploads/avatars/')) removeFile(path.join(config.avatarsDir, path.basename(previous)));

    const updated = toPublicUser({ ...req.user, avatar_url: avatarUrl });
    onUserChanged(updated);
    return res.json(updated);
  });

  return router;
}

/**
 * Arquivos servidos por URL com nome aleatório (o <img> não envia cookie de forma confiável entre origens).
 * Tudo que não é imagem comum é forçado a download e isolado por CSP: nada enviado por alguém executa no navegador.
 */
function uploadsStatic() {
  return express.static(config.uploadsDir, {
    index: false,
    dotfiles: 'deny',
    setHeaders(res, filePath) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      if (!INLINE_EXT.has(path.extname(filePath).toLowerCase())) res.setHeader('Content-Disposition', 'attachment');
    },
  });
}

module.exports = { createUploadsRouter, uploadsStatic };
