'use strict';

const Database = require('better-sqlite3');
const config = require('./config');
const { encryptField, decryptField, isEncrypted } = require('./fieldcrypto');

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password   TEXT    NOT NULL,                       -- hash bcrypt, nunca a senha
    avatar_url TEXT,
    role       TEXT    NOT NULL DEFAULT 'user'    CHECK (role IN ('user', 'admin')),
    status     TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
  );

  CREATE TABLE IF NOT EXISTS categories (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT    NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS channels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,  -- apagar a categoria apaga os canais
    name        TEXT    NOT NULL,
    type        TEXT    NOT NULL CHECK (type IN ('text', 'voice')),
    position    INTEGER NOT NULL DEFAULT 0,
    UNIQUE (category_id, name)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id      TEXT    NOT NULL,       -- id do canal (guardado como texto por compatibilidade)
    content         TEXT    NOT NULL DEFAULT '',   -- cifrado em repouso (enc:v1:...)
    attachment_url  TEXT,
    attachment_name TEXT,                   -- cifrado em repouso
    timestamp       INTEGER NOT NULL,       -- milissegundos desde a epoch
    is_edited       INTEGER NOT NULL DEFAULT 0,
    deleted_at      INTEGER,                -- exclusão lógica (milissegundos)
    CHECK (content <> '' OR attachment_url IS NOT NULL)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages (channel_id, id);

  CREATE TABLE IF NOT EXISTS reactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      TEXT    NOT NULL,
    UNIQUE (message_id, user_id, emoji)
  );
  CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions (message_id);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id    INTEGER NOT NULL REFERENCES users(id),
    action_type TEXT    NOT NULL,
    details     TEXT    NOT NULL DEFAULT '{}',   -- JSON (ids e nomes; nunca conteúdo de mensagens)
    timestamp   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs (timestamp);
`);

// --- Migrações de bancos criados por versões anteriores ---------------------------------
function ensureColumn(table, column, ddl) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  return !exists;
}
ensureColumn('messages', 'is_edited', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('messages', 'deleted_at', 'INTEGER');
ensureColumn('users', 'role', "TEXT NOT NULL DEFAULT 'user'");
// Contas que já existiam antes do controle de acesso continuam liberadas.
if (ensureColumn('users', 'status', "TEXT NOT NULL DEFAULT 'pending'")) db.exec("UPDATE users SET status = 'approved'");

// Estrutura inicial (só quando não há categorias): os canais que antes eram fixos no código.
if (db.prepare('SELECT COUNT(*) AS n FROM categories').get().n === 0) {
  db.transaction(() => {
    const category = db.prepare('INSERT INTO categories (name, position) VALUES (?, ?)');
    const channel = db.prepare('INSERT INTO channels (category_id, name, type, position) VALUES (?, ?, ?, ?)');
    const text = category.run('Canais de texto', 1).lastInsertRowid;
    const voice = category.run('Canais de voz', 2).lastInsertRowid;
    ['geral', 'aleatorio', 'dev'].forEach((name, i) => channel.run(text, name, 'text', i + 1));
    ['voz-geral', 'voz-reuniao'].forEach((name, i) => channel.run(voice, name, 'voice', i + 1));
    // Mensagens antigas guardavam o NOME do canal; passam a guardar o id.
    db.exec(`
      UPDATE messages
         SET channel_id = (SELECT c.id FROM channels c WHERE c.name = messages.channel_id AND c.type = 'text')
       WHERE channel_id NOT GLOB '[0-9]*'
         AND EXISTS (SELECT 1 FROM channels c WHERE c.name = messages.channel_id AND c.type = 'text')`);
  })();
}

// Mensagens gravadas em texto puro por versões anteriores passam a ser cifradas.
{
  const legacy = db
    .prepare(
      `SELECT id, content, attachment_name FROM messages
        WHERE (content <> '' AND content NOT LIKE 'enc:v1:%')
           OR (attachment_name IS NOT NULL AND attachment_name NOT LIKE 'enc:v1:%')`,
    )
    .all();
  if (legacy.length > 0) {
    const update = db.prepare('UPDATE messages SET content = ?, attachment_name = ? WHERE id = ?');
    db.transaction(() => {
      for (const row of legacy) update.run(encryptField(row.content), encryptField(row.attachment_name), row.id);
    })();
    console.log(`[db] ${legacy.length} mensagem(ns) antigas cifradas em repouso.`);
  }
}

// --- Consultas (sempre parametrizadas: nenhum valor externo é concatenado em SQL) -----------
const MESSAGE_SELECT = `
  SELECT m.id, m.channel_id, m.content, m.attachment_url, m.attachment_name, m.timestamp,
         m.is_edited, m.deleted_at,
         u.id AS author_id, u.username AS author_username, u.avatar_url AS author_avatar_url
  FROM messages m
  JOIN users u ON u.id = m.user_id`;

const stmts = {
  // usuários
  insertUser: db.prepare("INSERT INTO users (username, password, role, status) VALUES (?, ?, 'user', 'pending')"),
  userByUsername: db.prepare('SELECT id, username, password, avatar_url, role, status FROM users WHERE username = ?'),
  userById: db.prepare('SELECT id, username, avatar_url, role, status FROM users WHERE id = ?'),
  publicUserById: db.prepare('SELECT id, username, avatar_url FROM users WHERE id = ?'),
  approvedUsers: db.prepare("SELECT id, username, avatar_url FROM users WHERE status = 'approved' ORDER BY username COLLATE NOCASE"),
  pendingUsers: db.prepare("SELECT id, username, created_at FROM users WHERE status = 'pending' ORDER BY created_at"),
  setUserStatus: db.prepare("UPDATE users SET status = ? WHERE id = ? AND role <> 'admin'"),
  setAvatar: db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?'),

  // estrutura do servidor
  allCategories: db.prepare('SELECT id, name, position FROM categories ORDER BY position, id'),
  allChannels: db.prepare('SELECT id, category_id, name, type, position FROM channels ORDER BY position, id'),
  categoryById: db.prepare('SELECT id, name, position FROM categories WHERE id = ?'),
  channelById: db.prepare('SELECT id, category_id, name, type, position FROM channels WHERE id = ?'),
  channelsOfCategory: db.prepare('SELECT id, name, type FROM channels WHERE category_id = ?'),
  nextCategoryPosition: db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM categories'),
  nextChannelPosition: db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM channels WHERE category_id = ?'),
  insertCategory: db.prepare('INSERT INTO categories (name, position) VALUES (?, ?)'),
  renameCategory: db.prepare('UPDATE categories SET name = ? WHERE id = ?'),
  deleteCategory: db.prepare('DELETE FROM categories WHERE id = ?'),
  insertChannel: db.prepare('INSERT INTO channels (category_id, name, type, position) VALUES (?, ?, ?, ?)'),
  renameChannel: db.prepare('UPDATE channels SET name = ? WHERE id = ?'),
  deleteChannel: db.prepare('DELETE FROM channels WHERE id = ?'),
  deleteMessagesOfChannel: db.prepare('DELETE FROM messages WHERE channel_id = ?'),

  // mensagens
  insertMessage: db.prepare(
    `INSERT INTO messages (user_id, channel_id, content, attachment_url, attachment_name, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ),
  messageById: db.prepare(`${MESSAGE_SELECT} WHERE m.id = ?`),
  latestMessages: db.prepare(
    `${MESSAGE_SELECT} WHERE m.channel_id = ? AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT ?`,
  ),
  messagesBefore: db.prepare(
    `${MESSAGE_SELECT} WHERE m.channel_id = ? AND m.id < ? AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT ?`,
  ),
  messageRaw: db.prepare(
    'SELECT id, user_id, channel_id, content, attachment_url, deleted_at FROM messages WHERE id = ?',
  ),
  // "AND user_id = ?" é a trava no próprio SQL: editar é só do autor.
  editMessage: db.prepare(
    'UPDATE messages SET content = ?, is_edited = 1 WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
  ),
  deleteOwnMessage: db.prepare('UPDATE messages SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL'),
  deleteAnyMessage: db.prepare('UPDATE messages SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'), // moderação

  // reações
  addReaction: db.prepare('INSERT OR IGNORE INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'),
  removeReaction: db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'),
  reactionsFor: db.prepare('SELECT emoji, user_id FROM reactions WHERE message_id = ? ORDER BY id'),
  distinctEmojis: db.prepare('SELECT COUNT(DISTINCT emoji) AS n FROM reactions WHERE message_id = ?'),
  hasEmoji: db.prepare('SELECT 1 AS found FROM reactions WHERE message_id = ? AND emoji = ? LIMIT 1'),

  // auditoria
  insertAudit: db.prepare('INSERT INTO audit_logs (admin_id, action_type, details, timestamp) VALUES (?, ?, ?, ?)'),
  latestAudit: db.prepare(`
    SELECT l.id, l.action_type, l.details, l.timestamp,
           u.id AS admin_id, u.username AS admin_username, u.avatar_url AS admin_avatar_url
      FROM audit_logs l
      JOIN users u ON u.id = l.admin_id
     ORDER BY l.id DESC
     LIMIT 100`),
};

// --- Auditoria --------------------------------------------------------------------------
function createAuditLog(adminId, actionType, details = {}) {
  stmts.insertAudit.run(adminId, actionType, JSON.stringify(details), Date.now());
}

function listAuditLogs() {
  return stmts.latestAudit.all().map((row) => {
    let details = {};
    try {
      details = JSON.parse(row.details);
    } catch {
      /* registro corrompido: mostra sem detalhes */
    }
    return {
      id: row.id,
      action: row.action_type,
      details,
      timestamp: row.timestamp,
      admin: { id: row.admin_id, username: row.admin_username, avatar_url: row.admin_avatar_url },
    };
  });
}

// --- Estrutura (categorias e canais) ---------------------------------------------------
function getStructure() {
  const channels = stmts.allChannels.all();
  return stmts.allCategories.all().map((category) => ({
    ...category,
    channels: channels
      .filter((c) => c.category_id === category.id)
      .map(({ id, name, type, position }) => ({ id, name, type, position })),
  }));
}

// --- Mensagens ------------------------------------------------------------------------
function groupReactions(rows) {
  const groups = new Map();
  for (const { emoji, user_id: userId } of rows) {
    if (!groups.has(emoji)) groups.set(emoji, { emoji, count: 0, userIds: [] });
    const group = groups.get(emoji);
    group.count += 1;
    group.userIds.push(userId);
  }
  return [...groups.values()];
}

const reactionsOf = (messageId) => groupReactions(stmts.reactionsFor.all(messageId));

/** Grava a mensagem com conteúdo e nome do anexo cifrados. Retorna o id. */
function createMessage({ userId, channelId, content, attachment }) {
  const info = stmts.insertMessage.run(
    userId,
    String(channelId), // coluna de texto: sempre comparar/gravar como texto, independente do driver
    encryptField(content),
    attachment?.url ?? null,
    encryptField(attachment?.name ?? null),
    Date.now(),
  );
  return Number(info.lastInsertRowid);
}

const editMessageContent = (id, userId, content) => stmts.editMessage.run(encryptField(content), id, userId).changes;

function toMessage(row, reactions = []) {
  return {
    id: row.id,
    channel: Number(row.channel_id),
    content: decryptField(row.content),
    attachment: row.attachment_url ? { url: row.attachment_url, name: decryptField(row.attachment_name) } : null,
    timestamp: row.timestamp,
    edited: Boolean(row.is_edited),
    reactions,
    author: { id: row.author_id, username: row.author_username, avatar_url: row.author_avatar_url },
  };
}

function toMessages(rows) {
  const byMessage = new Map();
  if (rows.length > 0) {
    const placeholders = rows.map(() => '?').join(','); // só "?": os valores vão como parâmetros
    const reactionRows = db
      .prepare(`SELECT message_id, emoji, user_id FROM reactions WHERE message_id IN (${placeholders}) ORDER BY id`)
      .all(...rows.map((row) => row.id));
    for (const r of reactionRows) {
      if (!byMessage.has(r.message_id)) byMessage.set(r.message_id, []);
      byMessage.get(r.message_id).push(r);
    }
  }
  return rows.map((row) => toMessage(row, groupReactions(byMessage.get(row.id) ?? [])));
}

/** Só o necessário para a interface: nada de hash de senha, status interno etc. */
const toPublicUser = (user) => ({ id: user.id, username: user.username, avatar_url: user.avatar_url, role: user.role });

module.exports = {
  db,
  stmts,
  isEncrypted,
  createAuditLog,
  listAuditLogs,
  getStructure,
  createMessage,
  editMessageContent,
  toMessage,
  toMessages,
  reactionsOf,
  groupReactions,
  toPublicUser,
};
