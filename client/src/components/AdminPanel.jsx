import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.js';
import Avatar from './Avatar.jsx';

const TABS = [
  { id: 'users', label: 'Cadastros' },
  { id: 'structure', label: 'Canais e Categorias' },
  { id: 'logs', label: 'Logs de Auditoria' },
];

// --- Aba 1: fila de cadastros pendentes ---------------------------------------------------
function PendingUsers() {
  const [users, setUsers] = useState(null);

  useEffect(() => {
    api('/admin/users/pending').then(setUsers).catch((err) => toast(err.message, 'error'));
  }, []);

  const decide = async (user, status) => {
    try {
      await api(`/admin/users/${user.id}/status`, { method: 'PUT', json: { status } });
      setUsers((list) => list.filter((u) => u.id !== user.id));
      toast(status === 'approved' ? `${user.username} aprovado.` : `${user.username} rejeitado.`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (!users) return <p className="hint">Carregando…</p>;
  if (users.length === 0) return <p className="hint">Nenhum cadastro aguardando aprovação.</p>;

  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>Usuário</th>
          <th>Pediu entrada em</th>
          <th aria-label="Ações" />
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <tr key={user.id}>
            <td>{user.username}</td>
            <td>{new Date(user.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
            <td className="admin-actions">
              <button type="button" className="btn btn-approve btn-small" onClick={() => decide(user, 'approved')}>
                Aprovar
              </button>
              <button type="button" className="btn btn-danger btn-small" onClick={() => decide(user, 'rejected')}>
                Rejeitar
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// --- Aba 2: CRUD de categorias e canais -----------------------------------------------------
function Structure({ categories, reload }) {
  const [newCategory, setNewCategory] = useState('');
  const [editing, setEditing] = useState(null); // { kind, id, value }
  const [confirming, setConfirming] = useState(null); // { kind, id }
  const [newChannel, setNewChannel] = useState(null); // { categoryId, name, type }

  // Executa a chamada; a barra lateral de todo mundo se atualiza pelo evento server-structure-changed.
  const run = async (call, okMessage) => {
    try {
      await call();
      if (okMessage) toast(okMessage, 'success');
      await reload();
      return true;
    } catch (err) {
      toast(err.message, 'error');
      return false;
    }
  };

  const createCategory = async (event) => {
    event.preventDefault();
    if (await run(() => api('/admin/categories', { method: 'POST', json: { name: newCategory } }), 'Categoria criada.')) {
      setNewCategory('');
    }
  };

  const saveRename = async (event) => {
    event.preventDefault();
    const path = editing.kind === 'category' ? `/admin/categories/${editing.id}` : `/admin/channels/${editing.id}`;
    if (await run(() => api(path, { method: 'PUT', json: { name: editing.value } }), 'Nome alterado.')) setEditing(null);
  };

  const confirmDelete = async () => {
    const path = confirming.kind === 'category' ? `/admin/categories/${confirming.id}` : `/admin/channels/${confirming.id}`;
    if (await run(() => api(path, { method: 'DELETE' }), 'Excluído.')) setConfirming(null);
  };

  const createChannel = async (event) => {
    event.preventDefault();
    if (await run(() => api('/admin/channels', { method: 'POST', json: newChannel }), 'Canal criado.')) setNewChannel(null);
  };

  const renameForm = (kind, id) => (
    <form className="inline-form" onSubmit={saveRename}>
      <input
        value={editing.value}
        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
        maxLength={32}
        aria-label={`Novo nome ${kind === 'category' ? 'da categoria' : 'do canal'}`}
        autoFocus
        required
      />
      <button type="submit" className="btn btn-small">Salvar</button>
      <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditing(null)}>Cancelar</button>
    </form>
  );

  const deleteControls = (kind, id, warning) =>
    confirming?.kind === kind && confirming.id === id ? (
      <span className="inline-form">
        <span className="warn">{warning}</span>
        <button type="button" className="btn btn-danger btn-small" onClick={confirmDelete}>Confirmar exclusão</button>
        <button type="button" className="btn btn-secondary btn-small" onClick={() => setConfirming(null)}>Cancelar</button>
      </span>
    ) : (
      <button type="button" className="btn btn-secondary btn-small" onClick={() => setConfirming({ kind, id })}>Excluir</button>
    );

  return (
    <div className="structure">
      <form className="inline-form" onSubmit={createCategory}>
        <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Nova categoria" maxLength={32} aria-label="Nome da nova categoria" required />
        <button type="submit" className="btn btn-small">+ Nova categoria</button>
      </form>

      {categories.map((category) => (
        <section key={category.id} className="admin-category">
          <div className="admin-row">
            {editing?.kind === 'category' && editing.id === category.id ? (
              renameForm('category', category.id)
            ) : (
              <>
                <h3 className="display">{category.name}</h3>
                <span className="admin-actions">
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditing({ kind: 'category', id: category.id, value: category.name })}>
                    Editar Nome
                  </button>
                  {deleteControls('category', category.id, 'Apaga também os canais e as mensagens deles.')}
                </span>
              </>
            )}
          </div>

          <ul>
            {category.channels.map((channel) => (
              <li key={channel.id} className="admin-row">
                {editing?.kind === 'channel' && editing.id === channel.id ? (
                  renameForm('channel', channel.id)
                ) : (
                  <>
                    <span>
                      {channel.type === 'voice' ? '♪' : '#'} {channel.name} <small className="hint">({channel.type === 'voice' ? 'voz' : 'texto'})</small>
                    </span>
                    <span className="admin-actions">
                      <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditing({ kind: 'channel', id: channel.id, value: channel.name })}>
                        Editar
                      </button>
                      {deleteControls('channel', channel.id, 'Apaga as mensagens do canal.')}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>

          {newChannel?.categoryId === category.id ? (
            <form className="inline-form" onSubmit={createChannel}>
              <input value={newChannel.name} onChange={(e) => setNewChannel({ ...newChannel, name: e.target.value })} placeholder="nome-do-canal" maxLength={32} aria-label="Nome do novo canal" autoFocus required />
              <select value={newChannel.type} onChange={(e) => setNewChannel({ ...newChannel, type: e.target.value })} aria-label="Tipo do canal">
                <option value="text">Texto</option>
                <option value="voice">Voz</option>
              </select>
              <button type="submit" className="btn btn-small">Criar</button>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setNewChannel(null)}>Cancelar</button>
            </form>
          ) : (
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setNewChannel({ categoryId: category.id, name: '', type: 'text' })}>
              + Novo Canal
            </button>
          )}
        </section>
      ))}
    </div>
  );
}

// --- Aba 3: log de auditoria ----------------------------------------------------------------
const dayFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

function describe({ action, details: d }) {
  switch (action) {
    case 'user.approve': return `aprovou o cadastro do usuário ${d.username}`;
    case 'user.reject': return `rejeitou o cadastro do usuário ${d.username}`;
    case 'message.delete': return `apagou uma mensagem de ${d.authorUsername ?? 'alguém'} no canal #${d.channelName ?? d.channelId}`;
    case 'category.create': return `criou a categoria ${d.name}`;
    case 'category.rename': return `renomeou a categoria ${d.from} para ${d.to}`;
    case 'category.delete': return `excluiu a categoria ${d.name}`;
    case 'channel.create': return `criou o canal #${d.name}`;
    case 'channel.rename': return `renomeou o canal #${d.from} para #${d.to}`;
    case 'channel.delete': return `excluiu o canal #${d.name}`;
    default: return `executou a ação ${action}`;
  }
}

function AuditLog() {
  const [logs, setLogs] = useState(null);

  useEffect(() => {
    api('/admin/logs').then(setLogs).catch((err) => toast(err.message, 'error'));
  }, []);

  if (!logs) return <p className="hint">Carregando…</p>;
  if (logs.length === 0) return <p className="hint">Nenhuma ação registrada ainda.</p>;

  const today = dayFormat.format(Date.now());
  return (
    <ul className="audit-list">
      {logs.map((log) => {
        const day = dayFormat.format(log.timestamp);
        return (
          <li key={log.id}>
            <Avatar name={log.admin.username} src={log.admin.avatar_url} size={32} />
            <span>
              O admin <strong>{log.admin.username}</strong> {describe(log)} {day === today ? '' : `em ${day} `}às{' '}
              {timeFormat.format(log.timestamp)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function AdminPanel({ categories, reload, onClose }) {
  const [tab, setTab] = useState('users');

  const onKeyDown = useCallback((event) => event.key === 'Escape' && onClose(), [onClose]);
  useEffect(() => {
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Painel de administração">
      <div className="modal modal-wide">
        <header className="modal-header">
          <h2 className="display">Painel Admin</h2>
          <button type="button" className="btn btn-secondary btn-small" onClick={onClose}>Fechar</button>
        </header>

        <div className="tabs" role="tablist">
          {TABS.map(({ id, label }) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'is-active' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        <div className="modal-content" role="tabpanel">
          {tab === 'users' && <PendingUsers />}
          {tab === 'structure' && <Structure categories={categories} reload={reload} />}
          {tab === 'logs' && <AuditLog />}
        </div>
      </div>
    </div>
  );
}
