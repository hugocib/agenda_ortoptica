import { openDb } from '../src/db.js';
import { hashPassword } from '../src/auth.js';
import { buildApp } from '../src/server.js';
import { addDays, todayLocal, weekday } from '../src/time.js';

export const PW = 'palavra-passe-de-teste';
export const ORIGIN = 'http://localhost:80';

export async function makeApp() {
  const db = openDb(':memory:');
  const add = db.prepare('INSERT INTO users (username, display_name, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, 0)');
  add.run('hugo', 'Hugo', 'ortoptista', hashPassword(PW));
  add.run('sec', 'Secretária', 'secretariado', hashPassword(PW));
  const app = await buildApp({
    db,
    logger: false,
    config: { sessionIdleHours: 10, trustProxy: false, logLevel: 'silent', backupDir: '/tmp/ortoptica-test-backups', backupKeep: 3, backupEveryHours: 24 },
  });
  return { app, db };
}

export async function login(app, username) {
  const res = await post(app, '/login', null, { username, password: PW });
  if (res.statusCode !== 302) throw new Error(`login falhou: ${res.statusCode}`);
  return res.headers['set-cookie'].split(';')[0];
}

export function post(app, url, cookie, form = {}) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) {
    for (const item of Array.isArray(v) ? v : [v]) body.append(k, item);
  }
  return app.inject({
    method: 'POST', url, payload: body.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN, host: 'localhost:80', ...(cookie ? { cookie } : {}) },
  });
}

export function get(app, url, cookie) {
  return app.inject({ method: 'GET', url, headers: { host: 'localhost:80', ...(cookie ? { cookie } : {}) } });
}

/** Próxima data (a partir de amanhã) com o dia da semana pedido (2 = terça). */
export function nextWeekday(wd) {
  let d = addDays(todayLocal(), 1);
  while (weekday(d) !== wd) d = addDays(d, 1);
  return d;
}
