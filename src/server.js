import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import { config as defaultConfig } from './config.js';
import { openDb } from './db.js';
import { COOKIE, LoginLimiter, loadSession, purgeExpiredSessions, readCookie, sameOrigin } from './auth.js';
import { counts } from './repo.js';
import { todayLocal } from './time.js';
import { layout } from './ui.js';
import { html } from './html.js';
import { scheduleBackups } from './backup.js';
import authRoutes from './routes/auth.js';
import todayRoutes from './routes/today.js';
import requestRoutes from './routes/requests.js';
import examRoutes from './routes/exams.js';
import reportRoutes from './routes/reports.js';
import agendaRoutes from './routes/agenda.js';
import statsRoutes from './routes/stats.js';
import adminRoutes from './routes/admin.js';
import miscRoutes from './routes/misc.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, '..', 'public');

const PUBLIC_PATHS = [/^\/login$/, /^\/static\//, /^\/manifest\.webmanifest$/, /^\/sw\.js$/, /^\/healthz$/, /^\/ics\//, /^\/offline$/];

export async function buildApp({ db, config = defaultConfig, logger = true } = {}) {
  const app = Fastify({
    logger: logger && {
      level: config.logLevel,
      // Nunca registar cookies nem corpos de pedidos (dados de saúde).
      redact: ['req.headers.cookie', 'req.headers.authorization'],
      serializers: {
        req: (r) => ({ method: r.method, url: r.url.replace(/^\/ics\/[^/]+/, '/ics/***') }),
      },
    },
    trustProxy: config.trustProxy,
    bodyLimit: 256 * 1024,
  });

  const deps = { db, config, limiter: new LoginLimiter() };
  app.decorate('deps', deps);
  app.decorateRequest('user', null);
  app.decorateRequest('counts', null);

  await app.register(formbody);
  await app.register(fastifyStatic, {
    root: PUBLIC_DIR,
    prefix: '/static/',
    maxAge: '1d',
    index: false,
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    const ct = String(reply.getHeader('content-type') || '');
    // Páginas com dados de doentes não ficam em cache do browser nem de proxies.
    if (ct.startsWith('text/html') || ct.startsWith('text/csv') || ct.startsWith('text/calendar')) {
      reply.header('Cache-Control', 'no-store');
    }
    return payload;
  });

  app.addHook('preHandler', async (req, reply) => {
    const url = req.url.split('?')[0];
    const token = readCookie(req.headers.cookie, COOKIE);
    req.user = loadSession(db, token, config.sessionIdleHours);

    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) {
      return reply.code(403).type('text/plain; charset=utf-8').send('Pedido recusado (origem inválida). Recarregue a página e tente de novo.');
    }
    if (PUBLIC_PATHS.some((re) => re.test(url))) return;
    if (!req.user) {
      if (req.method === 'GET' || req.method === 'HEAD') return reply.redirect(`/login?next=${encodeURIComponent(req.url)}`);
      return reply.code(401).type('text/plain; charset=utf-8').send('Sessão expirada. Entre de novo.');
    }
    if (req.user.mustChangePassword && !['/conta', '/logout'].includes(url)) {
      return reply.redirect('/conta');
    }
    if (req.method === 'GET') req.counts = counts(db, todayLocal());
  });

  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'erro interno');
    else req.log.warn({ msg: err.message }, 'pedido inválido');
    const msg = status >= 500
      ? 'Ocorreu um erro inesperado. Nada foi perdido do que já estava guardado; tente de novo e, se repetir, veja os registos do servidor.'
      : 'Pedido inválido.';
    reply.code(status).type('text/html; charset=utf-8').send(layout(req, {
      title: 'Erro',
      body: html`<div class="page-head"><div class="page-title"><h1>Algo correu mal</h1></div></div><p>${msg}</p><p><a class="btn primary" href="/hoje">Voltar ao início</a></p>`,
    }));
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).type('text/html; charset=utf-8').send(layout(req, {
      title: 'Não encontrado',
      body: html`<div class="page-head"><div class="page-title"><h1>Não encontrado</h1></div></div><p>Esta página ou registo não existe (pode ter sido um endereço antigo).</p><p><a class="btn primary" href="/hoje">Voltar ao início</a></p>`,
    }));
  });

  for (const r of [authRoutes, todayRoutes, requestRoutes, examRoutes, reportRoutes, agendaRoutes, statsRoutes, adminRoutes, miscRoutes]) {
    await app.register(r, deps);
  }
  return app;
}

async function main() {
  const db = openDb(defaultConfig.dbFile);
  const app = await buildApp({ db });
  scheduleBackups(db, { dir: defaultConfig.backupDir, keep: defaultConfig.backupKeep, everyHours: defaultConfig.backupEveryHours, log: app.log });
  setInterval(() => purgeExpiredSessions(db, defaultConfig.sessionIdleHours), 3600 * 1000).unref();

  const shutdown = async (signal) => {
    app.log.info({ signal }, 'a terminar');
    try { await app.close(); } finally { db.close(); process.exit(0); }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: defaultConfig.port, host: defaultConfig.host });
  const users = db.prepare('SELECT COUNT(*) FROM users').pluck().get();
  if (users === 0) {
    app.log.warn('Ainda não há utilizadores. Crie o primeiro com: docker compose exec app node src/cli.js criar-utilizador <utilizador> "<Nome>" ortoptista');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
