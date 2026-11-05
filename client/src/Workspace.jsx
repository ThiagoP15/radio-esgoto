import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { COPY } from './copy.js';
import { getFx, setFx } from './fx.js';
import { getStoredStatus, setStoredStatus, socket } from './socket.js';
import { toast } from './toast.js';
import AdminPanel from './components/AdminPanel.jsx';
import ChatArea from './components/ChatArea.jsx';
import MembersPanel from './components/MembersPanel.jsx';
import Sidebar from './components/Sidebar.jsx';
import VoiceChannel from './components/VoiceChannel.jsx';
import { useChannels } from './hooks/useChannels.js';

// Aplica uma alteração a uma mensagem do estado (ignora canais/mensagens que não estão carregados).
const patchMessage = (prev, channel, id, patch) =>
  prev[channel] ? { ...prev, [channel]: prev[channel].map((m) => (m.id === id ? { ...m, ...patch(m) } : m)) } : prev;

export default function Workspace({ user, onUserChange, onLogout }) {
  const [connected, setConnected] = useState(false);
  const { categories, loaded, reload } = useChannels(connected);
  const [textId, setTextId] = useState(null);
  const [view, setView] = useState('text'); // 'text' | 'voice'
  const [voiceChannel, setVoiceChannel] = useState(null);
  const [messages, setMessages] = useState({}); // channelId -> mensagens
  const [presence, setPresence] = useState({}); // userId -> { id, username, avatar_url, status }
  const [voiceRooms, setVoiceRooms] = useState({}); // channelId -> pessoas na sala
  const [adminOpen, setAdminOpen] = useState(false);
  const [fxEnabled, setFxEnabled] = useState(getFx);
  const [navOpen, setNavOpen] = useState(false); // sidebar colapsável em telas estreitas

  const textChannels = useMemo(() => categories.flatMap((c) => c.channels.filter((ch) => ch.type === 'text')), [categories]);
  const voiceChannels = useMemo(() => categories.flatMap((c) => c.channels.filter((ch) => ch.type === 'voice')), [categories]);
  const textChannel = textChannels.find((c) => c.id === textId) ?? null;

  // Mantém a seleção válida quando um administrador renomeia ou apaga canais.
  useEffect(() => {
    if (!loaded) return;
    setTextId((current) => (textChannels.some((c) => c.id === current) ? current : textChannels[0]?.id ?? null));
    setVoiceChannel((current) => (current ? voiceChannels.find((c) => c.id === current.id) ?? null : null));
  }, [loaded, textChannels, voiceChannels]);

  useEffect(() => {
    if (view === 'voice' && !voiceChannel) setView('text');
  }, [view, voiceChannel]);

  // Conexão em tempo real (a sessão vai no cookie HttpOnly).
  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => {
      setConnected(false);
      setVoiceChannel(null); // o socket.id mudou: a sinalização da chamada se perdeu
    };
    const onConnectError = (err) => {
      setConnected(false);
      if (err.message === 'unauthorized') window.dispatchEvent(new Event('auth:expired'));
    };

    // Mensagens
    const onMessage = (msg) =>
      setMessages((prev) => {
        const list = prev[msg.channel] ?? [];
        if (list.some((m) => m.id === msg.id)) return prev;
        return { ...prev, [msg.channel]: [...list, msg] };
      });
    const onEdited = ({ id, channel, content }) =>
      setMessages((prev) => patchMessage(prev, channel, id, () => ({ content, edited: true })));
    // message-deleted: tira a mensagem da tela de todo mundo na hora
    const onDeleted = ({ id, channel }) =>
      setMessages((prev) => (prev[channel] ? { ...prev, [channel]: prev[channel].filter((m) => m.id !== id) } : prev));
    const onReactions = ({ messageId, channel, reactions }) =>
      setMessages((prev) => patchMessage(prev, channel, messageId, () => ({ reactions })));

    // Presença
    const onPresenceInit = (list) => setPresence(Object.fromEntries(list.map((u) => [u.id, u])));
    const onStatusUpdate = ({ user: u, status }) => setPresence((prev) => ({ ...prev, [u.id]: { ...u, status } }));
    const onUserUpdate = (u) => {
      setPresence((prev) => (prev[u.id] ? { ...prev, [u.id]: { ...prev[u.id], ...u } } : prev));
      setMessages((prev) =>
        Object.fromEntries(
          Object.entries(prev).map(([channel, list]) => [
            channel,
            list.map((m) => (m.author.id === u.id ? { ...m, author: { ...m.author, avatar_url: u.avatar_url } } : m)),
          ]),
        ),
      );
    };

    const handlers = {
      connect: onConnect,
      disconnect: onDisconnect,
      connect_error: onConnectError,
      'message:new': onMessage,
      'message-edited': onEdited,
      'message-deleted': onDeleted,
      'reaction-update': onReactions,
      'presence:init': onPresenceInit,
      'status-update': onStatusUpdate,
      'user-update': onUserUpdate,
      'voice:rooms': setVoiceRooms,
    };
    for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler);
    socket.connect();

    return () => {
      for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler);
      socket.disconnect();
    };
  }, []);

  const loadHistory = useCallback(async (channelId) => {
    const rows = await api(`/messages/${channelId}`); // últimas 50, já com reações
    setMessages((prev) => ({ ...prev, [channelId]: rows }));
  }, []);

  // Ao abrir um canal (ou reconectar): entra na sala do socket e busca o histórico por HTTP.
  useEffect(() => {
    if (!connected || !textId) return;
    socket.emit('channel:join', { channelId: textId }, (res) => {
      if (res?.ok) loadHistory(textId).catch((err) => toast(err.message, 'error'));
    });
  }, [connected, textId, loadHistory]);

  const myStatus = presence[user.id]?.status ?? getStoredStatus();

  const changeStatus = (status) => {
    socket.emit('set-status', { status }, (res) => {
      if (res?.ok) setStoredStatus(status);
      else toast(res?.error ?? 'Não foi possível mudar o status.', 'error');
    });
  };

  const toggleFx = () => {
    setFx(!fxEnabled);
    setFxEnabled(!fxEnabled);
  };

  const changeAvatar = async (file) => {
    const form = new FormData();
    form.append('avatar', file);
    try {
      onUserChange(await api('/users/avatar', { method: 'POST', form }));
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className={`app ${navOpen ? 'nav-open' : ''}`}>
      <Sidebar
        categories={categories}
        view={view}
        textChannelId={textId}
        voiceChannel={voiceChannel}
        voiceRooms={voiceRooms}
        user={user}
        status={myStatus}
        connected={connected}
        fxEnabled={fxEnabled}
        onSelectText={(channel) => {
          setTextId(channel.id);
          setView('text');
          setNavOpen(false);
        }}
        onJoinVoice={(channel) => {
          setVoiceChannel(channel);
          setView('voice');
          setNavOpen(false);
        }}
        onLeaveVoice={() => {
          setVoiceChannel(null);
          setView('text');
        }}
        onStatusChange={changeStatus}
        onAvatarChange={changeAvatar}
        onToggleFx={toggleFx}
        onOpenAdmin={() => setAdminOpen(true)}
        onLogout={onLogout}
      />

      <main className="main">
        {/* O VoiceChannel fica montado enquanto a pessoa navega pelos canais, para a chamada não cair.
            O VideoGrid dele aparece no topo da área de chat sempre que há uma transmissão. */}
        {voiceChannel && (
          <VoiceChannel
            channel={voiceChannel}
            user={user}
            hidden={view !== 'voice'}
            onToggleNav={() => setNavOpen((open) => !open)}
            onLeave={() => {
              setVoiceChannel(null);
              setView('text');
            }}
          />
        )}
        {textChannel ? (
          <ChatArea
            channel={textChannel}
            messages={messages[textChannel.id] ?? []}
            meId={user.id}
            isAdmin={user.role === 'admin'}
            connected={connected}
            hidden={view !== 'text'}
            onToggleNav={() => setNavOpen((open) => !open)}
          />
        ) : (
          <section className="chat" hidden={view !== 'text'}>
            <p className="empty">{loaded ? 'Nenhum canal de texto por aqui. Peça a um administrador para criar um.' : COPY.emptyChat}</p>
          </section>
        )}
      </main>

      <MembersPanel members={Object.values(presence)} />

      {adminOpen && <AdminPanel categories={categories} reload={reload} onClose={() => setAdminOpen(false)} />}
    </div>
  );
}
