import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, post, get, nextWeekday } from './helpers.js';
import { getSetting } from '../src/db.js';
import { addDays, todayLocal } from '../src/time.js';

test('agenda: vistas dia, semana e mês; a escolha fica no dispositivo', async () => {
  const { app, db } = await makeApp();
  const hugo = await login(app, 'hugo');
  const oct = db.prepare("SELECT id FROM exam_types WHERE code = 'oct'").pluck().get();
  const tue = nextWeekday(2);
  await post(app, `/r/${getSetting(db, 'booking_token')}/reservar`, null, { tipo: String(oct), start: `${tue}T09:00`, quem: 'Marta' });

  const day = await get(app, `/agenda?vista=dia&data=${tue}`, hugo);
  assert.equal(day.statusCode, 200);
  assert.match(day.body, /OCT segmento posterior/);
  assert.match(day.body, /aria-current="page">Dia</);
  assert.match(day.headers['set-cookie'], /vista_agenda=dia/);
  // Sem «vista», usa a última escolhida
  const again = await get(app, '/agenda', `${hugo}; vista_agenda=dia`);
  assert.match(again.body, /aria-current="page">Dia</);

  const month = await get(app, `/agenda?vista=mes&data=${tue}`, hugo);
  assert.match(month.body, /class="month"/);
  assert.match(month.body, new RegExp(`href="/agenda\\?vista=dia&data=${tue}"[^>]*aria-label="[^"]*: 1 exame"`));
  assert.match(month.body, /1<span class="m-l"> por confirmar/);

  const week = await get(app, `/agenda?vista=semana&data=${tue}`, hugo);
  assert.match(week.body, /aria-current="page">Semana</);
  // Compatibilidade com links antigos ?semana=
  assert.match((await get(app, `/agenda?semana=${tue}`, `${hugo}; vista_agenda=mes`)).body, /aria-current="page">Semana</);
});

test('realizado hoje (antecipado): o exame passa para hoje e a hora antiga fica livre', async () => {
  const { app, db } = await makeApp();
  const hugo = await login(app, 'hugo');
  const oct = db.prepare("SELECT id FROM exam_types WHERE code = 'oct'").pluck().get();
  const base = `/r/${getSetting(db, 'booking_token')}`;
  const tue = addDays(nextWeekday(2), 7);
  const r = await post(app, `${base}/reservar`, null, { tipo: String(oct), start: `${tue}T10:00`, requisicao: 'R-1', quem: 'Marta' });
  const id = Number(r.headers.location.match(/reservas\/(\d+)/)[1]);
  // Por confirmar: não se antecipa
  assert.match((await post(app, `/exames/${id}/antecipar`, hugo, {})).headers.location, /err=estado/);
  await post(app, `/exames/${id}/confirmar`, hugo, {});
  // «Realizado» normal continua recusado no futuro, com a dica
  assert.match((await post(app, `/exames/${id}/realizado`, hugo, {})).headers.location, /err=futuro/);
  const page = await get(app, `/exames/${id}`, hugo);
  assert.match(page.body, /Realizado hoje \(antecipado\)/);

  const a = await post(app, `/exames/${id}/antecipar`, hugo, {});
  assert.match(a.headers.location, /msg=antecipado/);
  const e = db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
  assert.equal(e.status, 'realizado');
  assert.equal(e.starts_at.slice(0, 10), todayLocal());
  assert.ok(e.performed_at);
  // A hora antiga voltou a estar livre no link
  const free = await get(app, `${base}?tipo=${oct}&semana=${tue}`);
  assert.match(free.body, new RegExp(`value="${tue}T10:00"`));
  // Não se antecipa duas vezes
  assert.match((await post(app, `/exames/${id}/antecipar`, hugo, {})).headers.location, /err=estado/);
});
