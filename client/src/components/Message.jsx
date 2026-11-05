import { useState } from 'react';
import { assetUrl } from '../api.js';
import Avatar from './Avatar.jsx';

const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif)$/i;
const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

function Attachment({ attachment }) {
  const href = assetUrl(attachment.url);
  if (IMAGE_RE.test(attachment.url)) {
    return (
      <a className="attachment-image" href={href} target="_blank" rel="noreferrer noopener">
        <img src={href} alt={attachment.name || 'Imagem enviada'} loading="lazy" />
      </a>
    );
  }
  return (
    <a className="attachment-file" href={href} target="_blank" rel="noreferrer noopener" download={attachment.name}>
      {attachment.name || 'Arquivo'}
    </a>
  );
}

const EditedTag = () => <span className="edited-tag">(editado)</span>;

function EditBox({ initial, hasAttachment, onSave, onCancel }) {
  const [value, setValue] = useState(initial);
  const empty = !value.trim() && !hasAttachment;

  const save = () => {
    if (!empty) onSave(value.trim());
  };
  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="edit-box">
      <textarea
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        maxLength={2000}
        rows={2}
        aria-label="Editar mensagem"
      />
      <p className="hint">
        Esc para{' '}
        <button type="button" className="link-button" onClick={onCancel}>
          cancelar
        </button>{' '}
        • Enter para{' '}
        <button type="button" className="link-button" onClick={save} disabled={empty}>
          salvar
        </button>
      </p>
    </div>
  );
}

function ReactionBar({ reactions, meId, onToggle }) {
  if (reactions.length === 0) return null;
  return (
    <div className="reactions">
      {reactions.map((reaction) => {
        const mine = reaction.userIds.includes(meId);
        return (
          <button
            key={reaction.emoji}
            type="button"
            className={`reaction ${mine ? 'is-mine' : ''}`}
            aria-pressed={mine}
            aria-label={`${reaction.emoji} ${reaction.count}${mine ? ', você reagiu' : ''}`}
            onClick={() => onToggle(reaction.emoji, mine)}
          >
            <span>{reaction.emoji}</span>
            <span className="reaction-count">{reaction.count}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function Message({
  msg,
  grouped,
  meId,
  isAdmin,
  editing,
  overlayOpen,
  onOpenPicker,
  onOpenMenu,
  onSaveEdit,
  onCancelEdit,
  onToggleReaction,
}) {
  const own = msg.author.id === meId;
  const canDelete = own || isAdmin; // admin pode apagar qualquer mensagem (moderação)
  const iso = new Date(msg.timestamp).toISOString();
  const anchorOf = (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.right, top: rect.top, bottom: rect.bottom };
  };

  const handleContextMenu = (event) => {
    if (!canDelete || editing) return;
    event.preventDefault();
    onOpenMenu(msg.id, { x: event.clientX, top: event.clientY, bottom: event.clientY });
  };

  return (
    <article className={`message group relative ${grouped ? 'is-grouped' : ''}`} onContextMenu={handleContextMenu}>
      {grouped ? (
        <time className="gutter-time" dateTime={iso}>
          {timeFormat.format(msg.timestamp)}
        </time>
      ) : (
        <Avatar name={msg.author.username} src={msg.author.avatar_url} />
      )}

      <div className="message-body">
        {!grouped && (
          <header>
            <strong>{msg.author.username}</strong>
            <time dateTime={iso}>{timeFormat.format(msg.timestamp)}</time>
            {msg.edited && <EditedTag />}
          </header>
        )}

        {editing ? (
          <EditBox
            initial={msg.content}
            hasAttachment={Boolean(msg.attachment)}
            onSave={(content) => onSaveEdit(msg.id, content)}
            onCancel={onCancelEdit}
          />
        ) : (
          <>
            {msg.content && (
              <p>
                {msg.content}
                {grouped && msg.edited && (
                  <>
                    {' '}
                    <EditedTag />
                  </>
                )}
              </p>
            )}
            {msg.attachment && <Attachment attachment={msg.attachment} />}
            {grouped && msg.edited && !msg.content && <EditedTag />}
          </>
        )}

        <ReactionBar
          reactions={msg.reactions ?? []}
          meId={meId}
          onToggle={(emoji, mine) => onToggleReaction(msg.id, emoji, mine)}
        />
      </div>

      {!editing && (
        <div className={`message-tools ${overlayOpen ? 'is-open' : ''}`}>
          <button
            type="button"
            data-overlay-trigger
            aria-label="Adicionar reação"
            title="Adicionar reação"
            onClick={(event) => onOpenPicker(msg.id, anchorOf(event.currentTarget))}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <path d="M9 9.5h.01M15 9.5h.01" />
            </svg>
          </button>
          {canDelete && (
            <button
              type="button"
              data-overlay-trigger
              aria-label="Mais opções"
              aria-haspopup="menu"
              title={own ? 'Editar ou excluir' : 'Moderação'}
              onClick={(event) => onOpenMenu(msg.id, anchorOf(event.currentTarget))}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </button>
          )}
        </div>
      )}
    </article>
  );
}
