import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getSetting } from '../db.js';
import { buildIcs } from '../ics.js';
import { examsWhere } from '../repo.js';
import { addDays, todayLocal } from '../time.js';
import { html } from '../html.js';
import { ASSET_VERSION, MARK } from '../ui.js';
import { send } from './util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SW_SOURCE = fs.readFileSync(path.join(here, '..', '..', 'public', 'sw.js'), 'utf8');

const MANIFEST = {
  id: '/hoje',
  name: 'Ortóptica — agenda e exames',
  short_name: 'Ortóptica',
  description: 'Agenda, registo no Siima e relatórios de exames de ortóptica e função visual.',
  lang: 'pt-PT',
  start_url: '/hoje',
  scope: '/',
  display: 'standalone',
  background_color: '#F3F5F4',
  theme_color: '#FFFFFF',
  categories: ['medical', 'productivity'],
  icons: [
    { src: '/static/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/static/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/static/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  shortcuts: [
    { name: 'Novo pedido', url: '/pedidos/novo' },
    { name: 'Agenda', url: '/agenda' },
  ],
};

function tokenEquals(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export default async function miscRoutes(app, { db }) {
  app.get('/healthz', async () => {
    db.prepare('SELECT 1').get();
    return { ok: true };
  });

  app.get('/manifest.webmanifest', async (req, reply) =>
    reply.type('application/manifest+json').header('Cache-Control', 'no-cache').send(JSON.stringify(MANIFEST)));

  // O service worker tem de ser servido da raiz para controlar todo o site.
  // A versão entra no ficheiro: ao atualizar a app, o browser instala o novo SW e limpa a cache antiga.
  app.get('/sw.js', async (req, reply) =>
    reply.type('application/javascript; charset=utf-8').header('Cache-Control', 'no-cache')
      .send(SW_SOURCE.replace('__VERSION__', ASSET_VERSION)));

  app.get('/offline', async (req, reply) => send(reply, req, {
    title: 'Sem ligação',
    bare: true,
    body: html`<div class="gate">${MARK}
      <h1>Sem ligação ao servidor</h1>
      <p class="lede">O computador onde a app corre pode estar desligado, em suspensão ou fora da rede.</p>
      <p>Por segurança, os dados dos doentes não ficam guardados neste dispositivo, por isso não há nada para mostrar sem ligação. Quando a ligação voltar, tente de novo.</p>
      <p><a class="btn primary big" href="/hoje">Tentar de novo</a></p></div>`,
  }));

  app.get('/ics/:token/agenda.ics', async (req, reply) => {
    if (!tokenEquals(req.params.token, getSetting(db, 'ics_token'))) return reply.code(404).send('Não encontrado');
    const today = todayLocal();
    const from = `${addDays(today, -30)}T00:00`;
    const to = `${addDays(today, 180)}T00:00`;
    const exams = examsWhere(db, "e.status IN ('agendado','realizado') AND e.starts_at >= ? AND e.starts_at < ?", [from, to], 'e.starts_at', 2000);
    const blocks = db.prepare('SELECT * FROM blocks WHERE ends_at >= ? AND starts_at < ?').all(from, to);
    const host = String(req.headers.host || 'ortoptica.local').replace(/:\d+$/, '');
    return reply.type('text/calendar; charset=utf-8').send(buildIcs({ exams, blocks, host }));
  });
}
