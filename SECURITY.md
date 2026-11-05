# Segurança do Rádio Esgoto

Este documento mostra **o que foi aplicado**, **onde está no código**, o que eu **não consegui fazer daqui**
(e como fazer) e os riscos que continuam. Ele foi escrito junto com o código, e as partes marcadas com ✅ têm
teste automatizado (`npm run pentest`, em `server/`) ou foram verificadas na hora.

## 1. Controles por categoria

### Credenciais e segredos
| Exigência | Situação | Onde |
|---|---|---|
| Esconder API keys | ✅ O app **não usa nenhuma API key de terceiros**. Os únicos segredos são `JWT_SECRET` e `DATA_ENCRYPTION_KEY`, lidos do ambiente; em produção o servidor **recusa iniciar** sem eles. O cliente nunca recebe segredos (o que vai no build é só `VITE_SERVER_URL` e `VITE_ICE_SERVERS`, que são públicos por natureza). | `server/src/config.js` |
| `.env` nunca exposto | ✅ `.env`, `.env.*`, `*.pem`, `*.key` e `server/data/` estão no `.gitignore`; `.dockerignore` impede o `.env` de entrar na imagem (o Compose injeta por `env_file`). `.env.example` não tem valores. | `.gitignore`, `server/.dockerignore` |
| Limpar secrets do histórico do Git | ⚠️ **Depende de você**: este pacote não tem histórico. Veja a seção 3. | — |

### Banco de dados (SQLite)
| Exigência | Situação | Onde |
|---|---|---|
| Só queries parametrizadas | ✅ Todas as consultas são `prepare()` com `?`. O único SQL montado dinamicamente é `IN (?,?,?)` (só marcadores; os valores vão como parâmetros). Testado com payloads de SQL injection. | `server/src/db.js` |
| Criptografia em repouso | ✅ **AES-256-GCM** (IV aleatório por registro, adulteração detectada) no **conteúdo das mensagens e no nome dos anexos**. Mensagens antigas em texto puro são cifradas na primeira inicialização. A chave vem de `DATA_ENCRYPTION_KEY`. Senhas são hash bcrypt (não reversível). | `server/src/fieldcrypto.js`, `db.js` |
| "Public Key DB" | ⚠️ **Não existe no SQLite.** "Public/anon key" é um conceito do Supabase/Postgres. O equivalente aqui é a chave de criptografia da aplicação acima (simétrica). Para cifrar o arquivo inteiro, a opção é SQLCipher; no Google Cloud o disco já é cifrado em repouso pelo próprio provedor. | — |
| RLS (Row Level Security) | ✅ **Simulado na aplicação** (o SQLite não tem RLS): políticas em `socket.js` (`policies`), e os `UPDATE` de editar/apagar filtram `user_id = ?` no próprio SQL. O usuário da operação sempre vem da sessão, nunca do cliente. | `socket.js`, `db.js`, `uploads.js` |

### Autenticação e sessão
| Exigência | Situação | Onde |
|---|---|---|
| Auth 100% no servidor | ✅ O cliente não decide nada: `role` e `status` são relidos do banco **a cada requisição e a cada evento de socket**. Rejeitar um usuário derruba as conexões dele na hora. | `auth.js`, `socket.js` |
| Cookies protegidos | ✅ JWT em cookie **HttpOnly** (JavaScript não enxerga), **Secure** + **SameSite=None** em produção (Lax em dev). Antes o token ficava no `localStorage`. | `auth.js`, `config.js` |
| Hash forte | ✅ bcrypt custo 12, com hash "falso" para usuário inexistente (sem enumeração por tempo). | `auth.js` |
| Acesso por rota/cargo | ✅ `isAdmin` em todo `/admin/*`; sem papel de admin → 403. Admin não altera outro admin. | `auth.js`, `admin.js` |
| Bloqueio de mass assignment | ✅ Schemas Zod com `.strict()` (campos desconhecidos viram 400); `role`/`status` nunca vêm do cliente: o INSERT fixa `'user'` e `'pending'`. | `schemas.js`, `db.js` |
| Aprovação manual | ✅ Cadastro nasce `pending`; login só emite sessão para `approved`; contas anteriores ao recurso foram migradas como aprovadas. | `auth.js`, `db.js` |

### Tráfego e API
| Exigência | Situação | Onde |
|---|---|---|
| Rate limit e proteção contra bots | ✅ Limite global (300/min), login (15 falhas/15 min por IP), cadastro (8/h), upload (40/10 min); **bloqueio por usuário** após 5 senhas erradas; **honeypot** no cadastro; e todo cadastro ainda precisa de aprovação humana. Não há captcha. | `security.js`, `auth.js` |
| Validação de inputs (Zod) | ✅ Todo corpo, parâmetro, query **e evento de socket** passa por Zod antes de chegar ao banco. | `schemas.js`, `security.js`, `socket.js` |
| Uploads restritos | ✅ Limite de tamanho (25 MB; avatar 2 MB), 1 arquivo por requisição, **tipo real conferido pelos bytes** (não pelo nome/mimetype), lista de tipos permitidos (sem HTML, SVG, executáveis, scripts), nome em disco sempre aleatório. Servidos com `nosniff`, `CSP: sandbox` e `Content-Disposition: attachment` (exceto imagens comuns). | `uploads.js`, `filetype.js` |
| Resposta enxuta | ✅ `/me` e `/login` devolvem só `id, username, avatar_url, role`; fila de pendentes só `id, username, created_at`; erros 500 não expõem detalhes (ficam no log). | `db.js` (`toPublicUser`), `index.js` |
| Security headers (Helmet) | ✅ CSP restritiva, `nosniff`, sem `X-Powered-By`, `frame-ancestors 'none'`, HSTS em produção. No app, CSP própria no build. | `security.js`, `client/vite.config.js` |
| HTTPS em produção | ✅ `FORCE_HTTPS` (padrão em produção): GET é redirecionado, o resto é recusado; cookie `Secure`. O Caddy emite o certificado sozinho (veja `DEPLOY_GCP.md`). | `security.js`, `Caddyfile` |
| CSRF e WebSocket | ✅ Toda escrita exige `Origin` autorizado + cabeçalho `X-Requested-With`; o WebSocket confere a origem (`allowRequest`). O app empacotado agora tem origem real (`app://radio-esgoto`) em vez de `file://`/`null`, que **não** pode ser liberada com credenciais. | `security.js`, `socket.js`, `client/electron/main.cjs` |

### Auditoria final
| Exigência | Situação |
|---|---|
| Scan de dependências | ⚠️ **Não consegui rodar** (sem acesso à rede). Rode `npm run audit` na raiz (seção 3). |
| Auditoria de segurança do código | ✅ Feita por mim (seção 2). Não é um laudo profissional. |
| Pentest com "Drael" | ⚠️ **Não conheço uma ferramenta chamada "Drael"** e não rodei nada com esse nome. Em vez disso criei um pentest próprio e executável: `npm run pentest` (seção 3). Se você quis dizer outra ferramenta (OWASP ZAP, Dradis, Strix...), me diga qual. |

## 2. Auditoria manual: o que encontrei e corrigi

1. **Token no `localStorage`** (legível por qualquer script) → cookie HttpOnly.
2. **App empacotado com origem `null`** (`file://`): para o servidor aceitar, seria preciso liberar `null` no CORS, o que deixa qualquer página sandboxed fazer requisições autenticadas → agora o app usa `app://radio-esgoto`.
3. **Sem proteção contra CSRF** depois da troca para cookie → `Origin` + cabeçalho customizado + `allowRequest` no socket.
4. **Upload aceitava qualquer arquivo** (confiava no nome) → lista de tipos + conferência dos bytes.
5. **Entrada sem validação central** → Zod em REST e Socket.io; eventos agora usam `channelId` numérico.
6. **Mensagens em texto puro no arquivo do banco** → AES-256-GCM.
7. **`role` vindo do token** poderia ficar defasado → relido do banco sempre.
8. **Canais fixos no código** → viraram tabelas, com cascata e limpeza de salas de socket quando um canal é apagado.
9. **STUN ausente**: com o servidor na nuvem e pessoas em redes diferentes, as chamadas não conectavam → STUN padrão (e TURN opcional no guia).
10. **`npm run start:client` abria o endereço do Vite** em vez do build → o Electron só usa o Vite com a flag `--dev`.

### Riscos que continuam (decisões conscientes ou limites)
- **Arquivos em `/uploads` são públicos para quem tem o link** (nome aleatório de 122 bits), porque `<img>` não envia o cookie entre origens. Para privacidade total seria preciso servir por rota autenticada com URLs assinadas.
- **Logout não invalida o JWT no servidor** (o cookie é apagado, mas o token vale até expirar em 7 dias se alguém o tiver copiado, o que o HttpOnly dificulta). Compensação: rejeitar/remover o usuário derruba o acesso na hora.
- **Limites de taxa ficam na memória** de um único processo (reiniciam com o servidor); suficiente para uma VM única.
- **`DATA_ENCRYPTION_KEY` mora no mesmo servidor do banco**: protege contra vazamento só do arquivo `.sqlite` ou do backup, não contra invasão da VM.
- **Mesh P2P expõe o IP dos participantes uns aos outros** (inerente ao WebRTC sem servidor de mídia).
- **Sem 2FA** e **sem assinatura de código** do app Electron.

## 3. Como verificar e o que fazer agora

**Dependências (precisa de internet):**
```bash
npm run audit            # na raiz: server + client (+ raiz)
```

**Pentest automatizado** (sobe um servidor temporário com banco temporário e ataca):
```bash
cd server && npm install && npm run pentest
```
Cobre: cabeçalhos, CSRF, rotas sem sessão, mass assignment, honeypot, SQL injection, cookies, escalada para admin,
validação de parâmetros, CRUD + auditoria, uploads disfarçados, vazamento de erro, WebSocket sem sessão, IDOR em
edição/exclusão de mensagem, moderação auditada, criptografia em repouso e rate limit.

**Limpar segredos do histórico do Git** (faça isto se algum `.env`/chave já foi commitado alguma vez):
```bash
git log --all --full-history -- .env server/.env          # existe no histórico?
pip install git-filter-repo
git filter-repo --path .env --path server/.env --invert-paths
git push --force --all && git push --force --tags
```
Depois **troque todos os segredos** (um segredo que já vazou deve ser considerado comprometido, mesmo removido do histórico)
e peça para colaboradores clonarem de novo. Para varrer o repositório: `docker run --rm -v "$PWD":/repo zricethezav/gitleaks detect -s /repo`.

**Antes de abrir para outras pessoas:** defina `JWT_SECRET` e `DATA_ENCRYPTION_KEY` (veja `server/.env.example`),
use HTTPS, crie o admin com `seed-admin.js` e **guarde a chave de criptografia fora da VM**.
