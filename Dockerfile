# --- dependências (inclui ferramentas de compilação para o better-sqlite3, se não houver binário pré-compilado)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Usa os cabeçalhos do Node que já vêm na imagem (não depende de descarregar de nodejs.org,
# que pode estar bloqueado na rede da UC).
ENV npm_config_nodedir=/usr/local
RUN npm ci --omit=dev

# --- imagem final, sem compiladores
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    BACKUP_DIR=/backups \
    PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /data /backups && chown -R node:node /data /backups
# Não corre como root dentro do contentor.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
