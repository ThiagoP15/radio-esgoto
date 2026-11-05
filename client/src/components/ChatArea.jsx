import { useEffect, useMemo, useRef, useState } from 'react';
import { api, assetUrl } from '../api.js';
import { COPY } from '../copy.js';
import { brand } from '../assets/index.js';
import { socket } from '../socket.js';
import Icon from './Icon.jsx';
import Message from './Message.jsx';
import MessageMenu from './MessageMenu.jsx';
import ReactionPicker from './ReactionPicker.jsx';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif)$/i;

export default function ChatArea({ channel, messages, meId, isAdmin, connected, hidden, onToggleNav }) {
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(null); // { url, name } já enviado por HTTP
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [overlay, setOverlay] = useState(null); // { type: 'picker' | 'menu', messageId, anchor }
  const fileRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, channel.id, hidden]);

  // Trocar de canal descarta rascunho, anexo, edição e popovers.
  useEffect(() => {
    setDraft('');
    setPending(null);
    setError('');
    setEditingId(null);
    setOverlay(null);
  }, [channel.id]);

  const rows = useMemo(
    () =>
      messages.map((msg, i) => {
        const prev = messages[i - 1];
        const grouped = prev && prev.author.id === msg.author.id && msg.timestamp - prev.timestamp < GROUP_WINDOW_MS;
        return { msg, grouped };
      }),
    [messages],
  );

  // --- Envio e upload -------------------------------------------------------------
  const pickFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('O arquivo passa de 25 MB.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const data = await api('/upload', { method: 'POST', form });
      setPending({ url: data.url, name: data.name });
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const send = () => {
    const content = draft.trim();
    if ((!content && !pending) || !connected || uploading) return;
    socket.emit('message:send', { channelId: channel.id, content, attachment: pending }, (res) => {
      if (!res?.ok) setError(res?.error ?? 'Não foi possível enviar.');
    });
    setDraft('');
    setPending(null);
    setError('');
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  // --- Edição, exclusão e reações (o servidor valida; o estado muda pelo broadcast) ------
  const report = (res, fallback) => {
    if (!res?.ok) setError(res?.error ?? fallback);
  };

  const saveEdit = (id, content) => {
    socket.emit('edit-message', { id, content }, (res) => {
      if (res?.ok) {
        setEditingId(null);
        setError('');
      } else {
        report(res, 'Não foi possível editar.');
      }
    });
  };

  const deleteMessage = (id) => {
    setOverlay(null);
    socket.emit('delete-message', { id }, (res) => report(res, 'Não foi possível excluir.'));
  };

  const toggleReaction = (messageId, emoji, mine) => {
    socket.emit(mine ? 'remove-reaction' : 'add-reaction', { messageId, emoji }, (res) =>
      report(res, 'Não foi possível reagir.'),
    );
  };

  const pickEmoji = (messageId, emoji) => {
    const msg = messages.find((m) => m.id === messageId);
    const mine = msg?.reactions?.find((r) => r.emoji === emoji)?.userIds.includes(meId) ?? false;
    setOverlay(null);
    toggleReaction(messageId, emoji, mine); // escolher de novo o mesmo emoji remove a reação
  };

  const openOverlay = (type) => (messageId, anchor) =>
    setOverlay((current) => (current?.type === type && current.messageId === messageId ? null : { type, messageId, anchor }));

  const menuTarget = overlay?.type === 'menu' ? messages.find((m) => m.id === overlay.messageId) : null;

  return (
    <section className="chat" hidden={hidden}>
      <header className="chat-header">
        <button type="button" className="menu-toggle" onClick={onToggleNav} aria-label="Abrir lista de canais">
          <Icon name="menu" size={22} />
        </button>
        <Icon name="canal-texto" size={22} />
        <h2 className="display">{channel.name}</h2>
      </header>

      <div className="messages" role="log" aria-live="polite">
        {messages.length === 0 && (
          <div className="empty">
            <img src={brand.empty} alt="Um rato espiando de dentro de um cano de esgoto" />
            <p>{COPY.emptyChat}</p>
          </div>
        )}
        {rows.map(({ msg, grouped }) => (
          <Message
            key={msg.id}
            msg={msg}
            grouped={grouped}
            meId={meId}
            isAdmin={isAdmin}
            editing={editingId === msg.id}
            overlayOpen={overlay?.messageId === msg.id}
            onOpenPicker={openOverlay('picker')}
            onOpenMenu={openOverlay('menu')}
            onSaveEdit={saveEdit}
            onCancelEdit={() => setEditingId(null)}
            onToggleReaction={toggleReaction}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}

      {pending && (
        <div className="pending">
          {IMAGE_RE.test(pending.url) && <img src={assetUrl(pending.url)} alt="" />}
          <span>{pending.name}</span>
          <button type="button" className="link-button" onClick={() => setPending(null)}>
            Remover
          </button>
        </div>
      )}

      <div className={`composer ${connected ? '' : 'is-disabled'}`}>
        <button
          type="button"
          className="plus"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || !connected}
          aria-label="Anexar arquivo"
          title="Anexar imagem ou arquivo"
        />
        <input ref={fileRef} type="file" onChange={pickFile} hidden />
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={COPY.placeholder(channel.name)}
          aria-label={`Mensagem para #${channel.name}`}
          maxLength={2000}
          rows={1}
        />
        <button type="button" className="btn" onClick={send} disabled={!connected || uploading || (!draft.trim() && !pending)}>
          {COPY.send}
        </button>
      </div>

      {overlay?.type === 'picker' && (
        <ReactionPicker anchor={overlay.anchor} onPick={(emoji) => pickEmoji(overlay.messageId, emoji)} onClose={() => setOverlay(null)} />
      )}
      {menuTarget && (
        <MessageMenu
          anchor={overlay.anchor}
          canEdit={menuTarget.author.id === meId}
          moderating={menuTarget.author.id !== meId}
          onEdit={() => {
            setEditingId(menuTarget.id);
            setOverlay(null);
          }}
          onDelete={() => deleteMessage(menuTarget.id)}
          onClose={() => setOverlay(null)}
        />
      )}
    </section>
  );
}
