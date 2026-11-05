# Rádio Esgoto

Chat desktop privado em tempo real (estilo Discord), com tema "bar clandestino de ratos num esgoto vitoriano".
Stack: Electron + React/Vite + Tailwind (client) · Node.js + Express + Socket.io (server) · SQLite (`better-sqlite3`).
O acesso é fechado: todo cadastro precisa de aprovação manual de um administrador.

## Estrutura

```
radio-esgoto/
├── package.json             # scripts da raiz
├── docker-compose.yml       # app (server) + Caddy (HTTPS automático)
├── Caddyfile  .env.example  # DOMAIN do Caddy
├── DEPLOY_GCP.md            # tutorial: VM e2-micro do Google Cloud
├── SECURITY.md              # controles, auditoria, pendências
├── server/
│   ├── index.js             # bootstrap: Helmet, CORS, rate limit, CSRF, rotas, erros
│   ├── seed-admin.js        # cria/promove o administrador inicial
│   ├── Dockerfile  .dockerignore  .env.example
│   ├── tests/pentest.test.js
│   └── src/
│       ├── config.js        # ambiente, segredos, cookie, pastas (/data no Docker)
│       ├── db.js            # schema, migrações, consultas, auditoria, criptografia de campos
│       ├── fieldcrypto.js   # AES-256-GCM
│       ├── filetype.js      # tipo real do arquivo (magic bytes)
│       ├── schemas.js       # Zod (REST + Socket.io)
│       ├── security.js      # headers, HTTPS, CSRF, validate(), limitadores
│       ├── auth.js          # /register /login /logout /me, requireAuth, isAdmin
│       ├── admin.js         # /admin/*: cadastros, categorias, canais, logs
│       ├── uploads.js       # /upload, /users/avatar, /uploads (estático)
│       ├── messages.js      # /channels, /messages/:channelId
│       └── socket.js        # sessão por cookie, chat, presença, voz/WebRTC, moderação
└── client/
    ├── electron/            # main.cjs (app://radio-esgoto, permissões, tela) e preload.cjs
    ├── build/icon.png|ico   # ícone do app
    └── src/
        ├── styles.css       # TEMA COMPLETO (variáveis em :root, comentado por elemento)
        ├── assets/          # sprites de latão, texturas, logo, ilustrações (kit do tema)
        ├── copy.js          # textos do tema ("Guinchar", estado vazio...)
        ├── api.js socket.js fx.js toast.js
        ├── hooks/           # useChannels (escuta server-structure-changed), useDismiss
        ├── voice/VoiceSession.js   # WebRTC mesh (independe de React)
        └── components/      # Sidebar, ChatArea, Message, AdminPanel, VoiceChannel, VideoGrid...
```

## Comandos (Node >= 20)

```bash
npm run install:all     # dependências da raiz, do server e do client
npm run seed-admin      # PRIMEIRO PASSO: cria o administrador (sem ele ninguém é aprovado)
npm run dev             # server (3001) + Vite (5173) + Electron (--dev)

npm run dev:server | dev:client | start:server | build:client
npm run start:client    # build do cliente + Electron carregando o build (app://radio-esgoto)
npm run audit           # npm audit (precisa de internet)
npm run pentest         # sobe um servidor temporário e ataca (server/tests)
```

Em desenvolvimento o servidor gera `JWT_SECRET` e `DATA_ENCRYPTION_KEY` em `server/data/` (fora do Git).
Em produção as duas variáveis são obrigatórias (`server/.env.example`). Deploy: `DEPLOY_GCP.md`.

## Configuração

| Variável | Onde | Padrão | Uso |
|---|---|---|---|
| `NODE_ENV` | server | — | `production` liga HTTPS obrigatório, cookie Secure/SameSite=None e exige segredos |
| `JWT_SECRET` / `DATA_ENCRYPTION_KEY` | server | gerados em dev | assinatura da sessão / chave AES-256 (base64, 32 bytes) |
| `CORS_ORIGINS` | server | `http://localhost:5173,app://radio-esgoto` | origens aceitas (HTTP e WebSocket) |
| `DATA_DIR` | server | `server/data` | `database.sqlite` e `uploads/` (Docker: `/data`, volume) |
| `TRUST_PROXY` `FORCE_HTTPS` `PUBLIC_HOST` | server | produção: 1 / true / — | atrás do Caddy |
| `COOKIE_SAMESITE` `COOKIE_SECURE` | server | prod: none / true | cookie de sessão |
| `VITE_SERVER_URL` | client `.env` | `http://localhost:3001` | endereço do servidor (entra na CSP do build) |
| `VITE_ICE_SERVERS` | client `.env` | STUN do Google | STUN/TURN em JSON; `[]` = só rede local |

## API REST

Sessão: cookie HttpOnly `res_session`. Toda escrita exige `X-Requested-With: RadioEsgoto` e `Origin` autorizado.

- Público: `POST /register`, `POST /login` (403 `PENDING` "Aguardando aprovação" / `REJECTED`), `POST /logout`, `GET /health`
- Sessão: `GET /me`, `GET /channels` (categorias com canais), `GET /messages/:channelId[?before=id]`, `POST /upload`, `POST /users/avatar`
- Admin (`isAdmin`): `GET /admin/users/pending`, `PUT /admin/users/:id/status` (`approved`|`rejected`),
  `POST|PUT|DELETE /admin/categories[/:id]`, `POST|PUT|DELETE /admin/channels[/:id]`, `GET /admin/logs`

## Eventos Socket.io

Sem cookie válido a conexão é recusada (`unauthorized`). Handshake: `auth: { status }` (último status escolhido).

- Chat: `channel:join {channelId}`, `message:send {channelId, content, attachment?}` → `message:new`
- Edição/exclusão: `edit-message {id, content}` → `message-edited`; `delete-message {id}` → `message-deleted`
  (autor **ou admin**; admin apagando mensagem alheia gera `message.delete` no log de auditoria)
- Reações: `add-reaction` / `remove-reaction {messageId, emoji}` → `reaction-update`
- Presença: `set-status {status}` → `status-update`; `presence:init`; `user-update`
- Estrutura: `server-structure-changed` (emitido a cada criar/editar/excluir de categoria ou canal)
- Voz: `voice:join {channelId}`, `voice:leave`, `voice:peer-joined|peer-left`, `voice:rooms`,
  `voice:screen {sharing, streamId}`, sinalização `offer` / `answer` / `ice-candidate` (`{to, data}` → `{from, data}`)

## Regras do projeto

- **Nunca** confiar no cliente: autor, `role` e `status` vêm da sessão/banco. Validar tudo com Zod (`schemas.js`).
- SQL sempre parametrizado. Mensagens e nomes de anexos são cifrados em repouso (`createMessage`, `toMessage`).
- `messages.channel_id` é coluna de texto: grave e compare sempre `String(channelId)`.
- Novas rotas de admin vão em `admin.js` (já atrás de `isAdmin`) e devem registrar `createAuditLog`.
- Tema: cores só por variáveis de `:root`; textos do tema em `copy.js`; efeitos desligáveis (`data-fx="off"`)
  e desligados por `prefers-reduced-motion`. Tailwind roda com `preflight: false` (bordas exigem `border-solid`).
- Electron: `contextIsolation`, `sandbox`, sem `nodeIntegration`; permissões negadas por padrão (só microfone e
  notificações); ponte do preload é `window.radioEsgoto`. Não libere `null` no CORS: o app usa `app://radio-esgoto`.
- WebRTC: perfect negotiation em `VoiceSession.js`; `voice:screen` é emitido ANTES de adicionar as tracks de tela.
  Mesh P2P: até 6 pessoas por sala; para mais, o caminho é um SFU (LiveKit/mediasoup).
- Banco antigo (`ratodiscord.db`) é renomeado sozinho para `database.sqlite`; contas antigas viram `approved`.

## Pendências conhecidas

Veja a seção "Riscos que continuam" em `SECURITY.md`. Próximos passos sugeridos: empacotar com electron-builder
(ícone em `client/build/`), invalidação de sessão no servidor (lista de revogação), URLs assinadas para uploads.
