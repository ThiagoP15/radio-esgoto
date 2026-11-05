'use strict';

// Toda entrada externa (REST e Socket.io) passa por aqui antes de chegar ao banco.
const { z } = require('zod');

const STATUSES = ['online', 'away', 'dnd', 'offline'];
const ATTACHMENT_URL_RE = /^\/uploads\/files\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

// Um emoji só: pictograma/bandeira/keycap, com modificadores e junções (ZWJ). Nada de texto livre.
const EMOJI_RE =
  /^(?:[0-9#*]\uFE0F?\u20E3|(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[\u200D\uFE0F\u20E3\u{E0020}-\u{E007F}])*)$/u;

const id = z.number().int().positive();
const idFromString = z.string().regex(/^\d{1,10}$/, 'Identificador inválido.').transform(Number);

const username = z
  .string({ required_error: 'Informe o nome de usuário.' })
  .trim()
  .regex(/^[\p{L}\p{N}_.-]{3,24}$/u, 'Nome de usuário: 3 a 24 caracteres (letras, números, _ . -).');
const password = z
  .string({ required_error: 'Informe a senha.' })
  .min(8, 'Senha: de 8 a 72 caracteres.')
  .max(72, 'Senha: de 8 a 72 caracteres.')
  .refine((v) => Buffer.byteLength(v) <= 72, 'Senha: de 8 a 72 caracteres.'); // limite real do bcrypt
const channelName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,31}$/u, 'Nome do canal: até 32 caracteres (letras, números, - e _).');

// .strict(): campos desconhecidos (ex.: role, status) são rejeitados — bloqueia mass assignment.
const rest = {
  register: z
    .object({
      username,
      password,
      website: z.string().max(0, 'Requisição inválida.').optional(), // honeypot: humanos não preenchem
    })
    .strict(),
  login: z
    .object({ username: z.string().trim().min(1).max(24), password: z.string().min(1).max(72) })
    .strict(),
  idParam: z.object({ id: idFromString }).strict(),
  channelParam: z.object({ channelId: idFromString }).strict(),
  historyQuery: z.object({ before: idFromString.optional() }).strict(),
  userStatus: z.object({ status: z.enum(['approved', 'rejected']) }).strict(),
  category: z.object({ name: z.string().trim().min(1, 'Informe o nome.').max(32, 'Máximo de 32 caracteres.') }).strict(),
  channelCreate: z.object({ categoryId: id, name: channelName, type: z.enum(['text', 'voice']) }).strict(),
  channelUpdate: z.object({ name: channelName }).strict(),
};

const content = z.string().trim().max(2000);
const socket = {
  setStatus: z.object({ status: z.enum(STATUSES) }),
  channelJoin: z.object({ channelId: id }),
  messageSend: z.object({
    channelId: id,
    content: content.default(''),
    attachment: z
      .object({ url: z.string().regex(ATTACHMENT_URL_RE), name: z.string().max(255).nullable().optional() })
      .nullable()
      .optional(),
  }),
  editMessage: z.object({ id, content }),
  deleteMessage: z.object({ id }),
  reaction: z.object({ messageId: id, emoji: z.string().max(32).regex(EMOJI_RE) }),
  voiceJoin: z.object({ channelId: id }),
  voiceScreen: z.object({ sharing: z.boolean(), streamId: z.string().max(100).optional() }),
  signal: z.object({ to: z.string().max(40), data: z.record(z.string(), z.unknown()) }),
};

module.exports = { rest, socket, STATUSES, EMOJI_RE, ATTACHMENT_URL_RE };
