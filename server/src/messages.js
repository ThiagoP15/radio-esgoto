'use strict';

const express = require('express');
const config = require('./config');
const { stmts, getStructure, toMessages } = require('./db');
const { requireAuth } = require('./auth');
const { rest } = require('./schemas');
const { validate } = require('./security');

const router = express.Router();

// Categorias com seus canais, na ordem de exibição.
router.get('/channels', requireAuth, (_req, res) => res.json({ categories: getStructure() }));

// Últimas 50 mensagens do canal, em ordem cronológica. ?before=<id> pagina para trás.
router.get(
  '/messages/:channelId',
  requireAuth,
  validate(rest.channelParam, 'params'),
  validate(rest.historyQuery, 'query'),
  (req, res) => {
    const { channelId } = req.valid.params;
    const channel = stmts.channelById.get(channelId);
    if (!channel || channel.type !== 'text') return res.status(404).json({ error: 'Canal inexistente.' });

    const { before } = req.valid.query;
    const key = String(channelId); // messages.channel_id é texto
    const rows = before
      ? stmts.messagesBefore.all(key, before, config.historyPageSize)
      : stmts.latestMessages.all(key, config.historyPageSize);
    return res.json(toMessages(rows.reverse()));
  },
);

module.exports = router;
