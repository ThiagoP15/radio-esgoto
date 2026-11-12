import { useRef, useState } from 'react';
import { COPY } from '../copy.js';
import { sprite } from '../assets/index.js';
import Avatar from './Avatar.jsx';
import AvatarWithStatus from './AvatarWithStatus.jsx';
import Icon from './Icon.jsx';
import StatusMenu from './StatusMenu.jsx';
import { STATUS_LABEL } from './StatusBadge.jsx';
import AmbientRats from './AmbientRats.jsx';

const GearIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
    <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l1.9-1.5-1.9-3.3-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14.1 2h-3.8l-.4 2.6A7.6 7.6 0 0 0 7.3 6.1l-2.3-.9-1.9 3.3L5 10.5a7.6 7.6 0 0 0 0 3l-1.9 1.5L5 18.3l2.3-.9a7.6 7.6 0 0 0 2.6 1.5l.4 2.6h3.8l.4-2.6a7.6 7.6 0 0 0 2.6-1.5l2.3.9 1.9-3.3-1.9-1.5Z" />
  </svg>
);

export default function Sidebar({
  categories,
  view,
  textChannelId,
  voiceChannel,
  voiceRooms,
  user,
  status,
  connected,
  fxEnabled,
  onSelectText,
  onJoinVoice,
  onLeaveVoice,
  onStatusChange,
  onAvatarChange,
  onToggleFx,
  onOpenAdmin,
  onLogout,
}) {
  const fileRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const mark = sprite('rato-latao');

  const handleAvatar = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onAvatarChange(file);
  };

  return (
    <nav className="sidebar" aria-label="Canais">
      {/* Placa do servidor: moldura déco de latão + rato + nome em fonte de cartaz */}
      <header className="sidebar-header">
        <img className="brand-mark" src={mark.src} srcSet={mark.srcSet} alt="" />
        <span className="display brand-name">{COPY.appName}</span>
      </header>

      <div className="channel-scroll">
        {categories.map((category) => (
          <section key={category.id}>
            <p className="sidebar-title">{category.name}</p>
            <ul className="channel-list">
              {category.channels.map((channel) => {
                const isVoice = channel.type === 'voice';
                const active = isVoice
                  ? view === 'voice' && voiceChannel?.id === channel.id
                  : view === 'text' && channel.id === textChannelId;
                const members = isVoice ? voiceRooms[channel.id] ?? [] : [];
                return (
                  <li key={channel.id}>
                    <button
                      type="button"
                      className={`channel ${active ? 'is-active' : ''}`}
                      aria-current={active ? 'true' : undefined}
                      onClick={() => (isVoice ? onJoinVoice(channel) : onSelectText(channel))}
                    >
                      {/* bueiro para canais de texto; cano com ondas sonoras para voz */}
                      <Icon name={isVoice ? 'canal-voz' : 'canal-texto'} size={18} />
                      <span className="display channel-name">{channel.name}</span>
                    </button>
                    {members.length > 0 && (
                      <ul className="voice-members">
                        {members.map((m, i) => (
                          <li key={`${m.id}-${i}`}>
                            <Avatar name={m.username} src={m.avatar_url} size={22} />
                            <span>{m.username}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
<div className="wall-life">
  <AmbientRats side="left" />
</div>
      <div className="mist" aria-hidden="true" />

      {voiceChannel && (
        <div className="call-bar">
          <span>
            <strong>Em chamada</strong>
            <small>{voiceChannel.name}</small>
          </span>
          <button type="button" className="btn btn-danger btn-small" onClick={onLeaveVoice}>
            Sair
          </button>
        </div>
      )}

      <footer className="user-bar relative">
        {menuOpen && (
          <StatusMenu
            status={status}
            fxEnabled={fxEnabled}
            onSelect={(next) => {
              onStatusChange(next);
              setMenuOpen(false);
            }}
            onChangePhoto={() => {
              setMenuOpen(false);
              fileRef.current?.click();
            }}
            onToggleFx={onToggleFx}
            onClose={() => setMenuOpen(false)}
          />
        )}
        <button
          type="button"
          className="avatar-button"
          data-overlay-trigger
          onClick={() => setMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Alterar status ou foto de perfil"
          title="Status e foto de perfil"
        >
          <AvatarWithStatus user={user} status={connected ? status : 'offline'} size={36} />
        </button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={handleAvatar} hidden />
        <div className="user-meta">
          <strong>{user.username}</strong>
          <small>{connected ? STATUS_LABEL[status] : 'Reconectando…'}</small>
        </div>
        {user.role === 'admin' && (
          <button type="button" className="icon-button" onClick={onOpenAdmin} aria-label="Painel de administração" title="Painel de administração">
            <GearIcon />
          </button>
        )}
        <button type="button" className="icon-button" onClick={onLogout} aria-label="Sair" title="Sair">
          <Icon name="sair" size={20} />
        </button>
      </footer>
    </nav>
  );
}
