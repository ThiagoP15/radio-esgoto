'use strict';

// Identifica o tipo REAL do arquivo pelos primeiros bytes. O mimetype e o nome vindos do cliente
// são ignorados: um .exe renomeado para .png é rejeitado.
const fs = require('node:fs');
const path = require('node:path');

const TEXT_EXT = new Set(['txt', 'csv', 'md', 'json', 'log']);
const ZIP_EXT = new Set(['zip', 'docx', 'xlsx', 'pptx', 'odt']);
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
  zip: 'application/zip', docx: 'application/zip', xlsx: 'application/zip', pptx: 'application/zip', odt: 'application/zip',
  '7z': 'application/x-7z-compressed', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg',
  txt: 'text/plain', csv: 'text/plain', md: 'text/plain', json: 'text/plain', log: 'text/plain',
};
const IMAGE_EXT = new Set(['png', 'jpg', 'gif', 'webp']);

function detect(buf, originalName) {
  const ascii = (a, b) => buf.subarray(a, b).toString('latin1');
  const original = path.extname(originalName || '').slice(1).toLowerCase();

  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(0, 5) === '%PDF-') return 'pdf';
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return ZIP_EXT.has(original) ? original : 'zip';
  }
  if (buf.length >= 6 && buf.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) return '7z';
  if (ascii(4, 8) === 'ftyp') return 'mp4';
  if (buf.length >= 4 && buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm';
  if (ascii(0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'mp3';

  if (TEXT_EXT.has(original) && buf.length > 0 && !buf.includes(0)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buf, { stream: true });
      return original;
    } catch {
      return null;
    }
  }
  return null;
}

/** Retorna { ext, mime, isImage } ou null se o conteúdo não for de um tipo permitido. */
function sniffFile(filePath, originalName) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(4096);
  let read;
  try {
    read = fs.readSync(fd, buf, 0, buf.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  const ext = detect(buf.subarray(0, read), originalName);
  return ext ? { ext, mime: MIME[ext], isImage: IMAGE_EXT.has(ext) } : null;
}

module.exports = { sniffFile, detect };
