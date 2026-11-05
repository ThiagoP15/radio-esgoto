# syntax=docker/dockerfile:1

# --- Estágio 1: instala as dependências (módulos nativos: bcrypt e better-sqlite3) ---
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Ferramentas de compilação só neste estágio: se não houver binário pré-compilado, ele compila aqui.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# --- Estágio 2: imagem final, enxuta e sem root ---
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/data
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data && chown node:node /data

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

USER node

# Tudo que precisa sobreviver a reinícios fica em /data:
#   /data/database.sqlite (banco)  ·  /data/uploads/ (arquivos e avatares)
VOLUME ["/data"]
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini repassa os sinais (docker stop encerra o Node direito)
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "index.js"]
