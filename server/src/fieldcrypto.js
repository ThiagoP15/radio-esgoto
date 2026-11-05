'use strict';

// Criptografia de campos em repouso (AES-256-GCM). O SQLite não tem "chave pública" nem criptografia
// nativa: o conteúdo sensível é cifrado pela aplicação antes de ir para o arquivo .sqlite.
const crypto = require('node:crypto');
const config = require('./config');

const PREFIX = 'enc:v1:';

function encryptField(plain) {
  if (plain === null || plain === undefined || plain === '') return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.dataKey, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

function decryptField(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value; // legado em texto puro
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', config.dataKey, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return '[mensagem ilegível]'; // chave errada ou dado adulterado
  }
}

const isEncrypted = (value) => typeof value === 'string' && value.startsWith(PREFIX);

module.exports = { encryptField, decryptField, isEncrypted };
