'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Server } = require('socket.io');
const config = require('./config');
const { stmts, toMessage, reactionsOf, createMessage, editMessageContent, createAuditLog } = require('./db');
const { decryptField } = require('./fieldcrypto');
const { userFromCookieHeader } = require('./auth');
const { socket: schemas } = require('./schemas');

const SIGNAL_EVENTS = ['offer', 'answer', 'ice-candidate'];
const MAX_REACTION_EMOJIS = 20; // emojis diferentes por mensagem

const textRoomName = (channelId) => `text:${channelId}`;
const voiceRoomName = (channelId) => `voice:${channelId}`;

function createLimiter(max, windowMs) {
  let stamps = [];
  return () => {
    const now = Date.now();
    stamps = stamps.filter((t) => now - t < windowMs);
    if (stamps.length >= max) return false;
    stamps.push(now);
    return true;
  };
}

// --- Políticas de acesso (equivalente a RLS: o SQLite não tem, então a regra vive aqui) ----
const policies = {
  canEditMessage: (actor, message) => message.user_id === actor.id, // só o autor
  canDeleteMessage: (actor, message) => message.user_id === actor.id || actor.role === 'admin', // autor ou moderador
};

function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.allowedOrigins, credentials: true },
    maxHttpBufferSize: 1e5,
    // Impede WebSocket vindo de outra origem (cross-site WebSocket hijacking).
    allowRequest: (req, callback) => {
      const { origin } = req.headers;
      callback(null, !origin || config.allowedOrigins.includes(origin));
    },
  });

  // --- Autenticação: sem cookie de sessão válido a conexão nem é aceita --------------------
  io.use((socket, next) => {
    try {
      const user = userFromCookieHeader(socket.handshake.headers.cookie);
      socket.data.user = { id: user.id, username: user.username };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  const publicUser = (id) => stmts.publicUserById.get(id);
  const currentActor = (socket) => stmts.userById.get(socket.data.user.id); // role/status sempre frescos
  const socketsOf = (userId) => [...io.sockets.sockets.values()].filter((s) => s.data.user?.id === userId);

  // --- Presença -----------------------------------------------------------------
  const userStatus = new Map(); // userId -> status (só quem tem ao menos uma conexão)
  const statusOf = (userId) => userStatus.get(userId) ?? 'offline';

  function setStatus(userId, status) {
    const previous = statusOf(userId);
    if (status === null) userStatus.delete(userId);
    else userStatus.set(userId, status);
    if (statusOf(userId) === previous) return;
    const user = publicUser(userId);
    if (user) io.emit('status-update', { user, status: statusOf(userId) });
  }

  const presenceList = () => stmts.approvedUsers.all().map((u) => ({ ...u, status: statusOf(u.id) }));
  const broadcastUserUpdate = (user) =>
    io.emit('user-update', { id: user.id, username: user.username, avatar_url: user.avatar_url });

  // --- Voz ----------------------------------------------------------------------
  const roomMembers = (channelId) => {
    const ids = io.sockets.adapter.rooms.get(voiceRoomName(channelId)) ?? new Set();
    return [...ids].map((id) => io.sockets.sockets.get(id)).filter(Boolean);
  };

  function voiceState() {
    const state = {};
    for (const channel of stmts.allChannels.all()) {
      if (channel.type === 'voice') {
        state[channel.id] = roomMembers(channel.id).map((s) => publicUser(s.data.user.id)).filter(Boolean);
      }
    }
    return state;
  }
  const broadcastVoice = () => io.emit('voice:rooms', voiceState());

  function leaveVoice(socket) {
    const channelId = socket.data.voiceRoom;
    if (!channelId) return;
    socket.leave(voiceRoomName(channelId));
    socket.data.voiceRoom = null;
    socket.data.screenStreamId = null;
    io.to(voiceRoomName(channelId)).emit('voice:peer-left', { socketId: socket.id });
    broadcastVoice();
  }

  // --- API usada pelas rotas de administração -----------------------------------------
  /** Avisa todos que categorias/canais mudaram e tira as conexões dos canais removidos. */
  function structureChanged(deletedChannelIds = []) {
    for (const channelId of deletedChannelIds) {
      for (const socket of io.sockets.sockets.values()) {
        if (socket.data.textChannel === channelId) {
          socket.leave(textRoomName(channelId));
          socket.data.textChannel = null;
        }
        if (socket.data.voiceRoom === channelId) leaveVoice(socket);
      }
    }
    io.emit('server-structure-changed');
  }

  const disconnectUser = (userId) => socketsOf(userId).forEach((s) => s.disconnect(true));

  // --- Mensagens: busca com checagem de permissão ---------------------------------------
  function loadMessage(id) {
    const row = stmts.messageRaw.get(id);
    return row && !row.deleted_at ? row : null;
  }

  /** Reagir exige estar no canal da mensagem: assim o broadcast só vai para quem está na sala. */
  function loadReactableMessage(socket, id) {
    const row = loadMessage(id);
    if (!row) return { error: 'Mensagem não encontrada.' };
    if (Number(row.channel_id) !== socket.data.textChannel) return { error: 'Abra o canal da mensagem para reagir.' };
    return { row };
  }

  const broadcastReactions = (row) =>
    io.to(textRoomName(row.channel_id)).emit('reaction-update', {
      messageId: row.id,
      channel: Number(row.channel_id),
      reactions: reactionsOf(row.id),
    });

  // --- Conexões ---------------------------------------------------------------
  io.on('connection', (socket) => {
    const { id: userId } = socket.data.user;
    const canSendMessage = createLimiter(10, 5000);
    const canChangeMessages = createLimiter(30, 5000); // editar, excluir e reagir
    const canChangeStatus = createLimiter(10, 10000);

    /** Registra um evento: valida o payload com Zod, aplica limite de taxa e protege contra exceções. */
    function on(event, schema, handler, limiter) {
      socket.on(event, (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (limiter && !limiter()) return reply({ ok: false, error: 'Calma: muitas ações seguidas.' });
        const parsed = schema.safeParse(payload);
        if (!parsed.success) return reply({ ok: false, error: 'Dados inválidos.' });
        try {
          return handler(parsed.data, reply);
        } catch (err) {
          console.error(`[socket:${event}]`, err);
          return reply({ ok: false, error: 'Erro interno.' });
        }
      });
    }

    // Presença: a primeira conexão da pessoa define o status (o cliente manda o último escolhido).
    if (socketsOf(userId).every((s) => s === socket)) {
      const requested = schemas.setStatus.safeParse({ status: socket.handshake.auth?.status });
      setStatus(userId, requested.success ? requested.data.status : 'online');
    }
    socket.emit('presence:init', presenceList());

    on(
      'set-status',
      schemas.setStatus,
      ({ status }, reply) => {
        setStatus(userId, status);
        reply({ ok: true });
      },
      canChangeStatus,
    );

    // Chat de texto ------------------------------------------------------------
    on('channel:join', schemas.channelJoin, ({ channelId }, reply) => {
      const channel = stmts.channelById.get(channelId);
      if (!channel || channel.type !== 'text') return reply({ ok: false, error: 'Canal inexistente.' });

      if (socket.data.textChannel) socket.leave(textRoomName(socket.data.textChannel));
      socket.join(textRoomName(channelId));
      socket.data.textChannel = channelId;
      return reply({ ok: true });
    });

    on(
      'message:send',
      schemas.messageSend,
      ({ channelId, content, attachment }, reply) => {
        if (channelId !== socket.data.textChannel) return reply({ ok: false, error: 'Canal inválido.' });
        if (attachment && !fs.existsSync(path.join(config.filesDir, path.basename(attachment.url)))) {
          return reply({ ok: false, error: 'Anexo não encontrado.' });
        }
        if (!content && !attachment) return reply({ ok: false, error: 'Mensagem vazia.' });

        // 1) grava no SQLite (cifrado); 2) só então faz o broadcast com os dados do autor.
        const id = createMessage({ userId, channelId, content, attachment });
        io.to(textRoomName(channelId)).emit('message:new', toMessage(stmts.messageById.get(id)));
        return reply({ ok: true });
      },
      canSendMessage,
    );

    // Edição e exclusão ---------------------------------------------------------
    on(
      'edit-message',
      schemas.editMessage,
      ({ id, content }, reply) => {
        const row = loadMessage(id);
        if (!row) return reply({ ok: false, error: 'Mensagem não encontrada.' });
        if (!policies.canEditMessage(currentActor(socket), row)) {
          return reply({ ok: false, error: 'Você só pode editar as suas próprias mensagens.' });
        }
        if (!content && !row.attachment_url) {
          return reply({ ok: false, error: 'A mensagem não pode ficar vazia. Use Excluir para apagá-la.' });
        }
        if (content === decryptField(row.content)) return reply({ ok: true }); // nada mudou

        if (editMessageContent(id, userId, content) === 0) return reply({ ok: false, error: 'Mensagem não encontrada.' });
        io.to(textRoomName(row.channel_id)).emit('message-edited', { id, channel: Number(row.channel_id), content });
        return reply({ ok: true });
      },
      canChangeMessages,
    );

    on(
      'delete-message',
      schemas.deleteMessage,
      ({ id }, reply) => {
        const row = loadMessage(id);
        if (!row) return reply({ ok: false, error: 'Mensagem não encontrada.' });

        const actor = currentActor(socket);
        if (!actor || actor.status !== 'approved' || !policies.canDeleteMessage(actor, row)) {
          return reply({ ok: false, error: 'Você não tem permissão para apagar esta mensagem.' });
        }

        const moderating = row.user_id !== actor.id;
        const result = moderating
          ? stmts.deleteAnyMessage.run(Date.now(), id)
          : stmts.deleteOwnMessage.run(Date.now(), id, actor.id);
        if (result.changes === 0) return reply({ ok: false, error: 'Mensagem não encontrada.' });

        if (moderating) {
          // Moderação (admin apagando mensagem de outra pessoa) entra no log de auditoria.
          createAuditLog(actor.id, 'message.delete', {
            messageId: id,
            channelId: Number(row.channel_id),
            channelName: stmts.channelById.get(Number(row.channel_id))?.name ?? null,
            authorId: row.user_id,
            authorUsername: publicUser(row.user_id)?.username ?? null,
          });
        }
        io.to(textRoomName(row.channel_id)).emit('message-deleted', { id, channel: Number(row.channel_id) });
        return reply({ ok: true });
      },
      canChangeMessages,
    );

    // Reações ---------------------------------------------------------------------
    on(
      'add-reaction',
      schemas.reaction,
      ({ messageId, emoji }, reply) => {
        const { row, error } = loadReactableMessage(socket, messageId);
        if (error) return reply({ ok: false, error });

        const isNewEmoji = !stmts.hasEmoji.get(row.id, emoji);
        if (isNewEmoji && stmts.distinctEmojis.get(row.id).n >= MAX_REACTION_EMOJIS) {
          return reply({ ok: false, error: `Máximo de ${MAX_REACTION_EMOJIS} emojis diferentes por mensagem.` });
        }
        stmts.addReaction.run(row.id, userId, emoji); // UNIQUE + OR IGNORE: repetir não duplica
        broadcastReactions(row);
        return reply({ ok: true });
      },
      canChangeMessages,
    );

    on(
      'remove-reaction',
      schemas.reaction,
      ({ messageId, emoji }, reply) => {
        const { row, error } = loadReactableMessage(socket, messageId);
        if (error) return reply({ ok: false, error });
        stmts.removeReaction.run(row.id, userId, emoji); // só remove a reação da própria pessoa
        broadcastReactions(row);
        return reply({ ok: true });
      },
      canChangeMessages,
    );

    // Voz: sala, sinalização WebRTC e tela ------------------------------------
    on('voice:join', schemas.voiceJoin, ({ channelId }, reply) => {
      const channel = stmts.channelById.get(channelId);
      if (!channel || channel.type !== 'voice') return reply({ ok: false, error: 'Sala inexistente.' });
      if (socket.data.voiceRoom === channelId) return reply({ ok: false, error: 'Você já está nessa sala.' });

      const members = roomMembers(channelId);
      if (members.length >= config.maxVoicePeers) {
        return reply({ ok: false, error: `Sala cheia (máximo de ${config.maxVoicePeers} pessoas).` });
      }

      leaveVoice(socket);
      const peers = members.map((s) => ({
        socketId: s.id,
        user: publicUser(s.data.user.id),
        screenStreamId: s.data.screenStreamId ?? null,
      }));

      socket.join(voiceRoomName(channelId));
      socket.data.voiceRoom = channelId;
      socket.to(voiceRoomName(channelId)).emit('voice:peer-joined', { socketId: socket.id, user: publicUser(userId) });
      broadcastVoice();
      return reply({ ok: true, peers });
    });

    socket.on('voice:leave', () => leaveVoice(socket));

    // Retransmite offer/answer/ice-candidate só entre sockets da MESMA sala de voz.
    for (const event of SIGNAL_EVENTS) {
      on(event, schemas.signal, ({ to, data }) => {
        const channelId = socket.data.voiceRoom;
        const target = io.sockets.sockets.get(to);
        if (!channelId || !target || target.data.voiceRoom !== channelId) return;
        target.emit(event, { from: socket.id, data });
      });
    }

    on('voice:screen', schemas.voiceScreen, ({ sharing, streamId }) => {
      const channelId = socket.data.voiceRoom;
      if (!channelId) return;
      socket.data.screenStreamId = sharing ? streamId ?? null : null;
      socket.to(voiceRoomName(channelId)).emit('voice:screen', {
        from: socket.id,
        sharing,
        streamId: socket.data.screenStreamId,
      });
    });

    socket.on('disconnect', () => {
      leaveVoice(socket);
      if (socketsOf(userId).length === 0) setStatus(userId, null); // última conexão caiu: offline para todos
    });

    socket.emit('voice:rooms', voiceState());
  });

  return { io, broadcastUserUpdate, structureChanged, disconnectUser };
}

module.exports = { createSocketServer };
