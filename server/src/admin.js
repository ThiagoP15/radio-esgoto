'use strict';

const express = require('express');
const { db, stmts, createAuditLog, listAuditLogs } = require('./db');
const { isAdmin, wrap } = require('./auth');
const { rest } = require('./schemas');
const { validate } = require('./security');

const isUnique = (err) => err.code === 'SQLITE_CONSTRAINT_UNIQUE';

function createAdminRouter({ realtime }) {
  const router = express.Router();
  router.use(isAdmin); // tudo abaixo exige sessão válida + role 'admin' (conferido no banco a cada requisição)

  // --- Cadastros ------------------------------------------------------------------
  router.get('/users/pending', (_req, res) => res.json(stmts.pendingUsers.all()));

  router.put('/users/:id/status', validate(rest.idParam, 'params'), validate(rest.userStatus), (req, res) => {
    const { id } = req.valid.params;
    const { status } = req.valid.body;
    const target = stmts.userById.get(id);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (target.role === 'admin') return res.status(400).json({ error: 'Não é possível alterar administradores.' });

    stmts.setUserStatus.run(status, id);
    createAuditLog(req.user.id, status === 'approved' ? 'user.approve' : 'user.reject', {
      userId: id,
      username: target.username,
    });
    if (status === 'rejected') realtime.disconnectUser(id); // derruba as conexões abertas dele
    return res.json({ id, status });
  });

  // --- Categorias -------------------------------------------------------------------
  router.post('/categories', validate(rest.category), (req, res) => {
    const { name } = req.valid.body;
    const info = stmts.insertCategory.run(name, stmts.nextCategoryPosition.get().n);
    const id = Number(info.lastInsertRowid);
    createAuditLog(req.user.id, 'category.create', { categoryId: id, name });
    realtime.structureChanged();
    return res.status(201).json({ id, name });
  });

  router.put('/categories/:id', validate(rest.idParam, 'params'), validate(rest.category), (req, res) => {
    const { id } = req.valid.params;
    const { name } = req.valid.body;
    const category = stmts.categoryById.get(id);
    if (!category) return res.status(404).json({ error: 'Categoria não encontrada.' });

    stmts.renameCategory.run(name, id);
    createAuditLog(req.user.id, 'category.rename', { categoryId: id, from: category.name, to: name });
    realtime.structureChanged();
    return res.json({ id, name });
  });

  router.delete('/categories/:id', validate(rest.idParam, 'params'), (req, res) => {
    const { id } = req.valid.params;
    const category = stmts.categoryById.get(id);
    if (!category) return res.status(404).json({ error: 'Categoria não encontrada.' });

    const channels = stmts.channelsOfCategory.all(id);
    db.transaction(() => {
      for (const channel of channels) stmts.deleteMessagesOfChannel.run(String(channel.id)); // mensagens (e reações) dos canais
      stmts.deleteCategory.run(id); // ON DELETE CASCADE remove os canais
    })();
    createAuditLog(req.user.id, 'category.delete', { categoryId: id, name: category.name, channels: channels.map((c) => c.name) });
    realtime.structureChanged(channels.map((c) => c.id));
    return res.status(204).end();
  });

  // --- Canais -----------------------------------------------------------------------
  router.post('/channels', validate(rest.channelCreate), (req, res) => {
    const { categoryId, name, type } = req.valid.body;
    if (!stmts.categoryById.get(categoryId)) return res.status(404).json({ error: 'Categoria não encontrada.' });
    try {
      const info = stmts.insertChannel.run(categoryId, name, type, stmts.nextChannelPosition.get(categoryId).n);
      const id = Number(info.lastInsertRowid);
      createAuditLog(req.user.id, 'channel.create', { channelId: id, name, type, categoryId });
      realtime.structureChanged();
      return res.status(201).json({ id, categoryId, name, type });
    } catch (err) {
      if (isUnique(err)) return res.status(409).json({ error: 'Já existe um canal com esse nome na categoria.' });
      throw err;
    }
  });

  router.put('/channels/:id', validate(rest.idParam, 'params'), validate(rest.channelUpdate), (req, res) => {
    const { id } = req.valid.params;
    const { name } = req.valid.body;
    const channel = stmts.channelById.get(id);
    if (!channel) return res.status(404).json({ error: 'Canal não encontrado.' });
    try {
      stmts.renameChannel.run(name, id);
      createAuditLog(req.user.id, 'channel.rename', { channelId: id, from: channel.name, to: name });
      realtime.structureChanged();
      return res.json({ id, name });
    } catch (err) {
      if (isUnique(err)) return res.status(409).json({ error: 'Já existe um canal com esse nome na categoria.' });
      throw err;
    }
  });

  router.delete('/channels/:id', validate(rest.idParam, 'params'), (req, res) => {
    const { id } = req.valid.params;
    const channel = stmts.channelById.get(id);
    if (!channel) return res.status(404).json({ error: 'Canal não encontrado.' });

    db.transaction(() => {
      stmts.deleteMessagesOfChannel.run(String(id));
      stmts.deleteChannel.run(id);
    })();
    createAuditLog(req.user.id, 'channel.delete', { channelId: id, name: channel.name, type: channel.type });
    realtime.structureChanged([id]);
    return res.status(204).end();
  });

  // --- Auditoria ------------------------------------------------------------------------
  router.get('/logs', (_req, res) => res.json(listAuditLogs()));

  return router;
}

module.exports = { createAdminRouter };
