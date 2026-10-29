import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, post, get } from './helpers.js';
import { getSetting } from '../src/db.js';
import { saveSubscription } from '../src/push.js';
import { sendDueReminders } from '../src/tasks.js';
import { addDays, todayLocal } from '../src/time.js';

const dmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const task = (db, id) => db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);

test('tarefas: criar, mover com ordem, feito, editar e apagar', async () => {
  const { app, db } = await makeApp();
  const hugo = await login(app, 'hugo');
  assert.match((await get(app, '/hoje', hugo)).body, /href="\/tarefas"/);

  // Adição rápida no quadro
  const q = await post(app, '/tarefas', hugo, { title: 'Rever protocolo MEG', col: 'afazer', project: '', back: '/tarefas' });
  assert.match(q.headers.location, /^\/tarefas\?msg=tarefa/);
  const a = db.prepare('SELECT id FROM tasks').pluck().get();
  await post(app, '/tarefas', hugo, { title: 'Pedir dados ao Prof.', col: 'afazer', project: 'neuroCSF', back: '/tarefas' });
  await post(app, '/tarefas', hugo, { title: 'Enviar preçário', col: 'afazer', back: '/tarefas' });
  const [, b, c] = db.prepare('SELECT id FROM tasks ORDER BY id').pluck().all();

  // Arrastar «c» para o topo de «Em curso», depois «a» para baixo dela
  let r = await post(app, `/tarefas/${c}/mover`, hugo, { col: 'emcurso', ids: String(c), ajax: '1' });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(JSON.parse(r.body), { ok: true });
  await post(app, `/tarefas/${a}/mover`, hugo, { col: 'emcurso', ids: `${c},${a}`, ajax: '1' });
  assert.deepEqual(db.prepare("SELECT id FROM tasks WHERE col = 'emcurso' ORDER BY position").pluck().all(), [c, a]);
  // Reordenar dentro da coluna
  await post(app, `/tarefas/${a}/mover`, hugo, { col: 'emcurso', ids: `${a},${c}`, ajax: '1' });
  assert.deepEqual(db.prepare("SELECT id FROM tasks WHERE col = 'emcurso' ORDER BY position").pluck().all(), [a, c]);
  // Coluna inválida
  assert.equal((await post(app, `/tarefas/${a}/mover`, hugo, { col: 'lixo', ajax: '1' })).statusCode, 400);

  // Botão «Feito» (sem JS)
  r = await post(app, `/tarefas/${b}/mover`, hugo, { col: 'feito', back: '/tarefas' });
  assert.match(r.headers.location, /msg=tarefa_feita/);
  assert.ok(task(db, b).done_at);
  const board = await get(app, '/tarefas', hugo);
  assert.match(board.body, /Rever protocolo MEG/);
  assert.match(board.body, /draggable="true"/);
  assert.match(board.body, /neuroCSF/);
  assert.match((await get(app, '/tarefas?projeto=neuroCSF', hugo)).body, /Pedir dados ao Prof\./);
  assert.ok(!(await get(app, '/tarefas?projeto=neuroCSF', hugo)).body.includes('Enviar preçário'));
  // Voltar de «Feito» limpa a data de conclusão
  await post(app, `/tarefas/${b}/mover`, hugo, { col: 'afazer', ajax: '1' });
  assert.equal(task(db, b).done_at, null);

  // Editar: título vazio recusado; prazo e lembrete
  assert.equal((await post(app, `/tarefas/${a}`, hugo, { title: '', col: 'emcurso' })).statusCode, 400);
  const tomorrow = addDays(todayLocal(), 1);
  r = await post(app, `/tarefas/${a}`, hugo, { title: 'Rever protocolo MEG', col: 'emcurso', notes: 'v2', project: 'MEG', due_date: dmy(tomorrow), remind_date: dmy(tomorrow), remind_time: '09:00' });
  assert.match(r.headers.location, /msg=tarefa_guardada/);
  assert.equal(task(db, a).remind_at, `${tomorrow}T09:00`);
  assert.equal(task(db, a).due_date, tomorrow);
  // Lembrete só com dia, sem hora: recusado
  assert.equal((await post(app, `/tarefas/${a}`, hugo, { title: 'x', col: 'afazer', remind_date: dmy(tomorrow), remind_time: '' })).statusCode, 400);

  r = await post(app, `/tarefas/${c}/apagar`, hugo, {});
  assert.match(r.headers.location, /msg=tarefa_apagada/);
  assert.equal(task(db, c), undefined);
});

test('tarefas: prazo de hoje aparece em «Hoje» e no contador; ligação a exame sem mudar o exame', async () => {
  const { app, db } = await makeApp();
  const hugo = await login(app, 'hugo');
  const oct = db.prepare("SELECT id FROM exam_types WHERE code = 'oct'").pluck().get();
  const c = await post(app, '/pedidos', hugo, { patient_process: '321', origin: 'externo', priority: 'normal', exam_type_id: String(oct) });
  const examId = Number(c.headers.location.match(/exames\/(\d+)/)[1]);
  const before = db.prepare('SELECT status, updated_at FROM exams WHERE id = ?').get(examId);

  assert.match((await get(app, `/tarefas/nova?exame=${examId}`, hugo)).body, /Ligada ao exame/);
  const r = await post(app, '/tarefas', hugo, { title: 'Pedir requisição', col: 'afazer', due_date: dmy(todayLocal()), exam_id: String(examId) });
  assert.match(r.headers.location, new RegExp(`/exames/${examId}\\?msg=tarefa`));
  const id = db.prepare('SELECT id FROM tasks').pluck().get();
  assert.equal(task(db, id).exam_id, examId);
  assert.deepEqual(db.prepare('SELECT status, updated_at FROM exams WHERE id = ?').get(examId), before);

  const exam = await get(app, `/exames/${examId}`, hugo);
  assert.match(exam.body, /Pedir requisição/);
  const hoje = await get(app, '/hoje', hugo);
  assert.match(hoje.body, /Tarefas para hoje/);
  assert.match(hoje.body, /href="\/tarefas" class="nav-i"><svg[^>]*>.*?<\/svg><span class="nav-l">Tarefas<\/span><span class="count owed">1<\/span>/s);
  // Concluir em «Hoje» volta a «Hoje»
  const done = await post(app, `/tarefas/${id}/mover`, hugo, { col: 'feito', back: '/hoje#tarefas' });
  assert.match(done.headers.location, /^\/hoje\?msg=tarefa_feita/);
  assert.ok(!(await get(app, '/hoje', hugo)).body.includes('Tarefas para hoje'));
});

test('lembretes: enviados uma vez, só a quem criou, e não com o quadro desligado', async () => {
  const { app, db } = await makeApp();
  const hugo = await login(app, 'hugo');
  const uid = db.prepare("SELECT id FROM users WHERE username = 'hugo'").pluck().get();
  saveSubscription(db, uid, { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } }, 'https://x.example');
  const today = todayLocal();
  await post(app, '/tarefas', hugo, { title: 'Ligar à Otília', col: 'afazer', project: 'neuroCSF', remind_date: dmy(today), remind_time: '08:00' });
  await post(app, '/tarefas', hugo, { title: 'Futura', col: 'afazer', remind_date: dmy(addDays(today, 3)), remind_time: '08:00' });
  const sent = [];
  const send = async (sub, payload) => { sent.push(JSON.parse(payload)); return { statusCode: 201 }; };
  assert.equal(await sendDueReminders(db, { now: `${today}T08:01`, send }), 1);
  assert.equal(sent[0].title, 'Lembrete: Ligar à Otília');
  assert.match(sent[0].url, /^\/tarefas\/\d+$/);
  // Não repete
  assert.equal(await sendDueReminders(db, { now: `${today}T08:05`, send }), 0);
  // Mudar a hora rearma
  const id = db.prepare("SELECT id FROM tasks WHERE title = 'Ligar à Otília'").pluck().get();
  await post(app, `/tarefas/${id}`, hugo, { title: 'Ligar à Otília', col: 'afazer', project: 'neuroCSF', remind_date: dmy(today), remind_time: '10:00' });
  assert.equal(await sendDueReminders(db, { now: `${today}T10:00`, send }), 1);

  // Desligar o quadro: sem menu, sem páginas, sem lembretes; os dados ficam
  await post(app, '/admin/tarefas', hugo, { on: '0' });
  assert.equal(getSetting(db, 'tasks_enabled'), false);
  assert.ok(!(await get(app, '/hoje', hugo)).body.includes('href="/tarefas"'));
  assert.equal((await get(app, '/tarefas', hugo)).statusCode, 404);
  const fid = db.prepare("SELECT id FROM tasks WHERE title = 'Futura'").pluck().get();
  assert.equal(await sendDueReminders(db, { now: `${addDays(today, 3)}T08:00`, send }), 0);
  assert.equal(db.prepare('SELECT COUNT(*) FROM tasks').pluck().get(), 2);
  await post(app, '/admin/tarefas', hugo, { on: '1' });
  assert.equal((await get(app, `/tarefas/${fid}`, hugo)).statusCode, 200);
});
