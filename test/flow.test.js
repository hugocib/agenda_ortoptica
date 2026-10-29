import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, columnOf, movesOf, staleDays } from '../src/domain/flow.js';
import { makeApp, login, post, get, nextWeekday } from './helpers.js';
import { getSetting } from '../src/db.js';
import { addDays, todayLocal } from '../src/time.js';

const T = '2026-11-10';
const ex = (o) => ({ id: 1, status: 'agendado', source: 'direto', starts_at: '2026-11-12T09:00', created_at: '2026-11-01T10:00:00Z', ...o });

test('fluxo: coluna de cada exame segundo o estado e o circuito', () => {
  assert.equal(columnOf(ex({ status: 'pendente', source: 'secretariado' }), T), 'entrada');
  assert.equal(columnOf(ex({ status: 'agendado', source: 'secretariado', change_kind: 'mover' }), T), 'entrada');
  assert.equal(columnOf(ex({ status: 'por_agendar', starts_at: null }), T), 'entrada');
  assert.equal(columnOf(ex({}), T), 'marcar');
  assert.equal(columnOf(ex({ siima_booked_at: 'x' }), T), 'agendado');
  assert.equal(columnOf(ex({ siima_booked_at: 'x', starts_at: '2026-11-10T09:00' }), T), 'fechar');
  assert.equal(columnOf(ex({ status: 'realizado', starts_at: '2026-11-03T09:00' }), T), 'relatorio');
  assert.equal(columnOf(ex({ status: 'realizado', report_status: 'validado' }), T), 'siima');
  assert.equal(columnOf(ex({ status: 'realizado', report_status: 'validado', siima_registered_at: 'x' }), T), 'feito');
  // Investigação não passa pelo Siima
  assert.equal(columnOf(ex({ source: 'investigacao' }), T), 'agendado');
  assert.equal(columnOf(ex({ source: 'investigacao', status: 'realizado', report_status: 'validado' }), T), 'feito');
  for (const s of ['cancelado', 'recusado', 'faltou']) assert.equal(columnOf(ex({ status: s }), T), null);
});

test('fluxo: só se arrasta para o passo seguinte; atrasos assinalados', () => {
  // Agendado no futuro não pode ir para «realizado»
  assert.deepEqual(Object.keys(movesOf(ex({ siima_booked_at: 'x' }), 'agendado', T)), []);
  const fechar = movesOf(ex({ siima_booked_at: 'x', starts_at: '2026-11-10T09:00' }), 'fechar', T);
  assert.deepEqual(Object.keys(fechar), ['relatorio']);
  assert.equal(fechar.relatorio.action, '/exames/1/realizado');
  // Reserva sem requisição: abre a página (não confirma às cegas)
  assert.equal(movesOf(ex({ status: 'pendente', source: 'secretariado' }), 'entrada', T).agendado.kind, 'go');
  assert.equal(movesOf(ex({ status: 'pendente', source: 'secretariado', requisition: 'R1' }), 'entrada', T).agendado.kind, 'post');
  // Relatório abre o relatório; Siima regista
  assert.equal(movesOf(ex({ status: 'realizado' }), 'relatorio', T).siima.href, '/exames/1/relatorio');
  assert.equal(movesOf(ex({ status: 'realizado', report_status: 'validado' }), 'siima', T).feito.action, '/exames/1/siima-registado');
  // Relatório parado há 7 dias (> 5) e Siima há 3 (> 2)
  assert.equal(staleDays(ex({ status: 'realizado', starts_at: '2026-11-03T09:00' }), 'relatorio', T), 7);
  assert.equal(staleDays(ex({ status: 'realizado', starts_at: '2026-11-06T09:00' }), 'relatorio', T), 0);
  assert.equal(staleDays(ex({ starts_at: '2026-11-07T09:00' }), 'siima', T), 3);
  // Concluído só dos últimos 7 dias
  const lanes = buildBoard([
    ex({ id: 2, status: 'realizado', report_status: 'validado', siima_registered_at: 'x', starts_at: '2026-11-08T09:00' }),
    ex({ id: 3, status: 'realizado', report_status: 'validado', siima_registered_at: 'x', starts_at: '2026-10-20T09:00' }),
  ], T);
  assert.deepEqual(lanes.find((l) => l.key === 'direto').cells.feito.map((c) => c.e.id), [2]);
});

test('fluxo: página com faixas, cartões e ações; no menu', async () => {
  const { app, db } = await makeApp();
  const hugo = await login(app, 'hugo');
  const types = Object.fromEntries(db.prepare('SELECT code, id FROM exam_types').all().map((t) => [t.code, String(t.id)]));
  const base = `/r/${getSetting(db, 'booking_token')}`;
  await post(app, `${base}/reservar`, null, { tipo: types.oct, start: `${nextWeekday(2)}T09:00`, requisicao: 'R-9', quem: 'Marta' });
  const d = addDays(todayLocal(), -1);
  await post(app, '/investigacao', hugo, { code: 'NCSF-7', project: 'neuroCSF', typeId: types.aval_visual, date: `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`, time: '18:00', minutes: '', notes: '' });
  const r = await get(app, '/fluxo', hugo);
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /href="\/fluxo" class="nav-i active"/);
  assert.match(r.body, /Secretariado/);
  assert.match(r.body, /Investigação/);
  assert.match(r.body, /Vez de: <b>ortoptista<\/b>\./);
  assert.ok(!r.body.includes('class="fl-ch-what"'), 'explicação só no «?»');
  assert.match(r.body, /Marcados para um dia que ainda não chegou/);
  assert.match(r.body, /Confirmar a reserva/);
  assert.match(r.body, /NCSF-7/);
  assert.match(r.body, /Avaliação realizada/);
  assert.ok(!r.body.includes('draggable'), 'sem arrastar');
  // Um só botão por cartão (o passo seguinte)
  for (const li of r.body.split('<li class="fl-card').slice(1)) assert.ok((li.split('</li>')[0].match(/class="btn mini/g) || []).length <= 1);
  // O botão no cartão faz o passo e volta ao quadro
  const id = db.prepare("SELECT e.id FROM exams e JOIN requests r ON r.id = e.request_id WHERE r.source = 'secretariado'").pluck().get();
  const c = await post(app, `/exames/${id}/confirmar`, hugo, { back: '/fluxo' });
  assert.match(c.headers.location, /^\/fluxo\?msg=confirmado/);
});
