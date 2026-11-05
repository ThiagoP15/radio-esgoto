# Deploy do Rádio Esgoto no Google Cloud (VM e2-micro, Ubuntu + Docker)

Este guia sobe o servidor (Node.js + SQLite) numa VM gratuita do Compute Engine, com HTTPS automático.
Tudo que você precisa copiar e colar está em blocos de código. Troque `SEU_DOMINIO` e `SEU_USUARIO`.

> **Antes de começar**
> - **HTTPS é obrigatório.** O login usa cookie `Secure` + `SameSite=None` (o app desktop fala com o servidor
>   de outra origem). Sem HTTPS o login não "gruda". Por isso o guia usa um domínio: o **DuckDNS** dá um de graça.
> - O nível gratuito do Google Cloud (1 VM e2-micro em `us-west1`, `us-central1` ou `us-east1`, 30 GB de disco
>   padrão, 1 GB/mês de saída de rede da América do Norte) muda com o tempo: confira em
>   <https://cloud.google.com/free> antes de criar. As chamadas de voz e telas vão **direto entre os
>   usuários (P2P)**, não passam pela VM, então o consumo de rede do servidor é pequeno.
> - Mantenha o repositório **privado** e nunca faça commit de `.env` (já está no `.gitignore`).

---

## 1. Criar a VM (painel do Google Cloud)

1. **Compute Engine → Instâncias de VM → Criar instância.**
2. **Tipo de máquina:** `e2-micro` · **Região:** `us-central1` (ou `us-west1` / `us-east1`).
3. **Disco de inicialização:** Ubuntu **24.04 LTS** · tipo **Disco permanente padrão** · **30 GB**.
4. **Firewall:** marque **Permitir tráfego HTTP** e **Permitir tráfego HTTPS**.
5. **Criar.** Anote o **IP externo**.
6. **IP fixo (recomendado):** *VPC → Endereços IP* → o IP da VM → **Promover para endereço IP estático**
   (é gratuito enquanto estiver anexado a uma VM ligada). Sem isso o IP muda quando a VM reinicia.

## 2. Abrir as portas no firewall do GCP

As caixas "Permitir tráfego HTTP/HTTPS" do passo anterior já criam as regras para as portas **80** e **443**.
Para conferir ou criar à mão: **Rede VPC → Firewall → Criar regra de firewall**:

| Campo | Valor |
|---|---|
| Nome | `radio-esgoto-web` |
| Direção | Entrada |
| Destinos | Tags de destino: `http-server, https-server` (ou "Todas as instâncias") |
| Intervalos de IP de origem | `0.0.0.0/0` |
| Protocolos e portas | TCP: `80,443` |

Ou, pelo Cloud Shell:

```bash
gcloud compute firewall-rules create radio-esgoto-web \
  --allow tcp:80,tcp:443 --direction INGRESS --source-ranges 0.0.0.0/0 \
  --target-tags http-server,https-server
```

**Não abra a porta 3001.** O Node fica atrás do Caddy; só o Caddy (80/443) fica exposto.

## 3. Domínio (DuckDNS, grátis)

1. Entre em <https://www.duckdns.org>, crie um subdomínio (ex.: `radioesgoto.duckdns.org`) e aponte para o **IP externo** da VM.
2. Seu `SEU_DOMINIO` é esse endereço completo.

## 4. Conectar por SSH e preparar o Ubuntu

No painel, na linha da VM, clique em **SSH**. No terminal que abrir, cole os blocos abaixo, um de cada vez.

**4.1 Atualizar os pacotes**

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install ca-certificates curl git openssl
```

**4.2 Criar 2 GB de swap** (a e2-micro tem só 1 GB de RAM; sem swap o build do Docker pode ser encerrado por falta de memória)

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

**4.3 Instalar o Docker (repositório oficial)**

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
docker --version && docker compose version
```

## 5. Baixar o projeto

```bash
git clone https://github.com/SEU_USUARIO/radio-esgoto.git
cd radio-esgoto
```

> Repositório privado: o `git clone` pede usuário e um **Personal Access Token** do GitHub (em vez da senha),
> ou use uma *deploy key* SSH somente leitura.

## 6. Criar os segredos (ficam só na VM)

Este bloco gera chaves aleatórias novas. **Troque `SEU_DOMINIO` pelo seu domínio antes de colar.**

```bash
cat > server/.env <<EOF
NODE_ENV=production
PORT=3001
JWT_SECRET=$(openssl rand -hex 32)
DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)
DATA_DIR=/data
CORS_ORIGINS=app://radio-esgoto
TRUST_PROXY=1
FORCE_HTTPS=true
PUBLIC_HOST=SEU_DOMINIO
COOKIE_SAMESITE=none
COOKIE_SECURE=true
EOF
chmod 600 server/.env

echo "DOMAIN=SEU_DOMINIO" > .env
```

> ⚠️ **Guarde uma cópia de `server/.env` fora da VM (gerenciador de senhas).** A `DATA_ENCRYPTION_KEY` cifra as
> mensagens no banco: se ela se perder, as mensagens salvas ficam **ilegíveis para sempre**.
> Para testar o app em desenvolvimento contra este servidor, acrescente `,http://localhost:5173` em `CORS_ORIGINS`.

## 7. Construir a imagem e subir os containers

```bash
docker compose up -d --build
```

A primeira construção leva alguns minutos na e2-micro. Depois:

```bash
docker compose ps                 # app e caddy devem estar "running" (app: "healthy")
docker compose logs -f app        # acompanhar o servidor (Ctrl+C sai dos logs, não derruba nada)
curl -I https://SEU_DOMINIO/health
```

O volume `radio_data` (mapeado em `/data` no container) guarda o **`database.sqlite`** e a pasta **`uploads/`**:
eles **não se perdem** ao reiniciar, recriar ou atualizar o container.

## 8. Criar a conta de administrador

```bash
docker compose exec -it app node seed-admin.js
```

Informe o nome e a senha (mínimo de 8 caracteres). Pronto: entre com essa conta e aprove os próximos cadastros
no Painel Admin (ícone de engrenagem no rodapé da barra lateral).

## 9. Apontar o app desktop para o servidor

Na sua máquina (onde roda o Electron), crie `client/.env`:

```
VITE_SERVER_URL=https://SEU_DOMINIO
```

e rode `npm run start:client` (gera o build e abre o app já apontando para o servidor).

---

## Rotina

**Atualizar** o servidor depois de um `git push`:

```bash
cd ~/radio-esgoto && git pull && docker compose up -d --build
```

**Backup** do banco e dos uploads (gera `radio-backup.tgz` na pasta atual):

```bash
docker run --rm -v radio-esgoto_radio_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/radio-backup.tgz -C /data .
```

**Parar / iniciar:** `docker compose stop` · `docker compose start`

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Caddy não emite o certificado | O domínio não aponta para o IP da VM, ou as portas 80/443 estão fechadas (passo 2). Veja `docker compose logs caddy`. |
| Build termina com "Killed" | Falta de memória: confira o swap (passo 4.2). |
| Login "não gruda" | Acesso por HTTP ou por IP. Use sempre `https://SEU_DOMINIO` e confira `COOKIE_SAMESITE=none` / `COOKIE_SECURE=true`. |
| App mostra erro de CORS / não conecta | `CORS_ORIGINS` precisa conter `app://radio-esgoto` (app empacotado) e, em desenvolvimento, `http://localhost:5173`. Depois de mudar, `docker compose up -d`. |
| Chamadas de voz não conectam entre redes diferentes | O P2P precisa de STUN (já configurado) e, em redes corporativas restritivas, de um servidor **TURN**. Veja abaixo. |

### (Opcional) TURN próprio para chamadas em redes restritivas

Rode um coturn na mesma VM e abra no firewall do GCP: `tcp,udp:3478` e `udp:49152-49200`.
Depois informe no `client/.env`:

```
VITE_ICE_SERVERS=[{"urls":"stun:SEU_DOMINIO:3478"},{"urls":"turn:SEU_DOMINIO:3478","username":"USUARIO","credential":"SENHA"}]
```

Sem TURN o app usa o STUN público do Google por padrão (isso expõe o IP dos participantes ao serviço de STUN).
Para não usar nenhum servidor externo, defina `VITE_ICE_SERVERS=[]` (as chamadas funcionam só dentro da mesma rede/VPN).

## Teste local da imagem (sem HTTPS)

```bash
docker build -t radio-esgoto ./server
docker run --rm -p 3001:3001 -v radio_data:/data \
  -e NODE_ENV=development -e FORCE_HTTPS=false -e COOKIE_SAMESITE=lax \
  radio-esgoto
```
