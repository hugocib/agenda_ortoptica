import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, post, get } from './helpers.js';
import { getSetting } from '../src/db.js';
import { saveSubscription } from '../src/push.js';
import { housekeeping, sendDueReminders } from '../src/tasks.js';
import { addDays, todayLocal } from '../src/time.js';

const dmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const task = (db, id) => db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);

test('tarefas: criar, mover com ordem, feito, editar e apagar', async () => {
  const { app, db } = await makeApp();
  const hugo = await login(app, 'hugo');
  assert.match((await get(app, '/hoje', hugo)).body, /href="\/tarefas"/);

  // Adição rápida no quadro
  const q = await post(app, '/tarefas', hugo, { title: 'Rever protocolo MEG', project: '', back: '/tarefas' });
  assert.match(q.headers.location, /^\/tarefas\?msg=tarefa/);
  const a = db.prepare('SELECT id FROM tasks').pluck().get();
  await post(app, '/tarefas', hugo, { title: 'Pedir dados ao Prof.', project: 'neuroCSF', back: '/tarefas' });
  await post(app, '/tarefas', hugo, { title: 'Enviar preçário', back: '/tarefas' });
  const [, b, c] = db.prepare('SELECT id FROM tasks ORDER BY id').pluck().all();

  // Arrastar «c» para o topo de «Em curso», depois «a» para baixo dela
  let r = await post(app, `/tarefas/${c}/mover`, hugo, { col: '2', ids: String(c), ajax: '1' });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(JSON.parse(r.body), { ok: true });
  await post(app, `/tarefas/${a}/mover`, hugo, { col: '2', ids: `${c},${a}`, ajax: '1' });
  assert.deepEqual(db.prepare("SELECT id FROM tasks WHERE column_id = 2 ORDER BY position").pluck().all(), [c, a]);
  // Reordenar dentro da coluna
  await post(app, `/tarefas/${a}/mover`, hugo, { col: '2', ids: `${a},${c}`, ajax: '1' });
  assert.deepEqual(db.prepare("SELECT id FROM tasks WHERE column_id = 2 ORDER BY position").pluck().all(), [a, c]);
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
  await post(app, `/tarefas/${b}/mover`, hugo, { col: '1', ajax: '1' });
  assert.equal(task(db, b).done_at, null);

  // Editar: título vazio recusado; prazo e lembrete
  assert.equal((await post(app, `/tarefas/${a}`, hugo, { title: '', column_id: '2' })).statusCode, 400);
  const tomorrow = addDays(todayLocal(), 1);
  r = await post(app, `/tarefas/${a}`, hugo, { title: 'Rever protocolo MEG', column_id: '2', notes: 'v2', project: 'MEG', due_date: dmy(tomorrow), remind_date: dmy(tomorrow), remind_time: '09:00' });
  assert.match(r.headers.location, /msg=tarefa_guardada/);
  assert.equal(task(db, a).remind_at, `${tomorrow}T09:00`);
  assert.equal(task(db, a).due_date, tomorrow);
  // Lembrete só com dia, sem hora: recusado
  assert.equal((await post(app, `/tarefas/${a}`, hugo, { title: 'x', column_id: '1', remind_date: dmy(tomorrow), remind_time: '' })).statusCode, 400);

  r = await post(app, `/tarefas/${c}/apagar`, hugo, {});
  assert.match(r.headers.location, new RegExp(`msg=tarefa_lixeira&u=${c}`));
  assert.ok(task(db, c).deleted_at);
  assert.ok(!(await get(app, '/tarefas', hugo)).body.includes('Enviar preçário'));
});

test('tarefas: prazo de hoje aparece em «Hoje» e no contador; ligação a exame sem mudar o exame', async () => {
  const { app, db } = await makeApp();
  const hugo = await login(app, 'hugo');
  const oct = db.prepare("SELECT id FROM exam_types WHERE code = 'oct'").pluck().get();
  const c = await post(app, '/pedidos', hugo, { patient_process: '321', origin: 'externo', priority: 'normal', exam_type_id: String(oct) });
  const examId = Number(c.headers.location.match(/exames\/(\d+)/)[1]);
  const before = db.prepare('SELECT status, updated_at FROM exams WHERE id = ?').get(examId);

  assert.match((await get(app, `/tarefas/nova?exame=${examId}`, hugo)).body, /Ligada ao exame/);
  const r = await post(app, '/tarefas', hugo, { title: 'Pedir requisição', due_date: dmy(todayLocal()), exam_id: String(examId) });
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
  await post(app, '/tarefas', hugo, { title: 'Ligar à Otília', project: 'neuroCSF', remind_date: dmy(today), remind_time: '08:00' });
  await post(app, '/tarefas', hugo, { title: 'Futura', remind_date: dmy(addDays(today, 3)), remind_time: '08:00' });
  const sent = [];
  const send = async (sub, payload) => { sent.push(JSON.parse(payload)); return { statusCode: 201 }; };
  assert.equal(await sendDueReminders(db, { now: `${today}T08:01`, send }), 1);
  assert.equal(sent[0].title, 'Lembrete: Ligar à Otília');
  assert.match(sent[0].url, /^\/tarefas\/\d+$/);
  // Não repete
  assert.equal(await sendDueReminders(db, { now: `${today}T08:05`, send }), 0);
  // Mudar a hora rearma
  const id = db.prepare("SELECT id FROM tasks WHERE title = 'Ligar à Otília'").pluck().get();
  await post(app, `/tarefas/${id}`, hugo, { title: 'Ligar à Otília', project: 'neuroCSF', remind_date: dmy(today), remind_time: '10:00' });
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

test('tarefas: hora do lembrete escrita, em vários formatos', async () => {
  const { app, db } = await makeApp();
  const hugo = await login(app, 'hugo');
  const d = dmy(addDays(todayLocal(), 1));
  for (const [typed, want] of [['1730', '17:30'], ['17h30', '17:30'], ['9', '09:00'], ['930', '09:30'], ['08:05', '08:05']]) {
    await post(app, '/tarefas', hugo, { title: `t ${typed}`, remind_date: d, remind_time: typed });
    assert.equal(db.prepare('SELECT remind_at FROM tasks WHERE title = ?').pluck().get(`t ${typed}`).slice(11), want, typed);
  }
  const bad = await post(app, '/tarefas', hugo, { title: 'x', remind_date: d, remind_time: '25:00' });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.body, /Hora inválida/);
  assert.match(bad.body, /data-time/);
});

test('tarefas: colunas editáveis (nome, ordem, número, concluídas) sem perder tarefas', async () => {
  const { app, db } = await makeApp();
  const hugo = await login(app, 'hugo');
  await post(app, '/tarefas', hugo, { title: 'A', column_id: '3' });
  await post(app, '/tarefas', hugo, { title: 'B', column_id: '4' });
  assert.match((await get(app, '/tarefas/colunas', hugo)).headers.location, /\/tarefas\/definicoes#colunas/);
  assert.match((await get(app, '/tarefas/definicoes', hugo)).body, /sim, tarefas para «A fazer»/);
  const save = (rows, done) => post(app, '/tarefas/colunas', hugo, {
    id: rows.map((r) => r.id), name: rows.map((r) => r.name), remove: rows.filter((r) => r.id).map((r) => r.remove || ''), done,
  });
  // Apagar «À espera» (com 1 tarefa) sem destino: recusado
  let r = await save([{ id: '1', name: 'A fazer' }, { id: '2', name: 'Em curso' }, { id: '3', name: 'À espera', remove: 'x' }, { id: '4', name: 'Feito' }, { id: '', name: '' }], '4');
  assert.equal(r.statusCode, 400);
  // Renomear, reordenar, apagar «À espera» passando a tarefa para «Em curso», e criar «Revisão»
  r = await save([{ id: '2', name: 'A decorrer' }, { id: '1', name: 'Ideias' }, { id: '3', name: 'À espera', remove: '2' }, { id: '4', name: 'Arquivo' }, { id: '', name: 'Revisão' }], '4');
  assert.equal(r.statusCode, 302);
  const cols = db.prepare('SELECT name, is_done FROM task_columns ORDER BY position').all();
  assert.deepEqual(cols.map((c) => c.name), ['A decorrer', 'Ideias', 'Arquivo', 'Revisão']);
  assert.deepEqual(cols.map((c) => c.is_done), [0, 0, 1, 0]);
  assert.equal(db.prepare("SELECT column_id FROM tasks WHERE title = 'A'").pluck().get(), 2);
  // «Feito» vai para a coluna de concluídas, seja qual for o nome
  const a = db.prepare("SELECT id FROM tasks WHERE title = 'A'").pluck().get();
  await post(app, `/tarefas/${a}/mover`, hugo, { col: 'feito', back: '/tarefas' });
  assert.equal(db.prepare('SELECT column_id FROM tasks WHERE id = ?').pluck().get(a), 4);
  // Mudar a coluna de concluídas: as tarefas da antiga deixam de estar feitas
  r = await save([{ id: '2', name: 'A decorrer' }, { id: '1', name: 'Ideias' }, { id: '4', name: 'Arquivo' }, { id: '5', name: 'Revisão' }, { id: '', name: '' }], '5');
  assert.equal(r.statusCode, 302);
  assert.equal(db.prepare('SELECT done_at FROM tasks WHERE id = ?').pluck().get(a), null);
  // Limites: não fica com menos de 2 colunas; nomes repetidos recusados
  r = await save([{ id: '2', name: 'X', remove: 'x' }, { id: '1', name: 'Ideias', remove: 'x' }, { id: '4', name: 'Arquivo', remove: '5' }, { id: '5', name: 'Revisão' }, { id: '', name: '' }], '5');
  assert.equal(r.statusCode, 400);
  r = await save([{ id: '2', name: 'Igual' }, { id: '1', name: 'igual' }, { id: '4', name: 'Arquivo' }, { id: '5', name: 'Revisão' }, { id: '', name: '' }], '5');
  assert.equal(r.statusCode, 400);
  const board = await get(app, '/tarefas', hugo);
  assert.match(board.body, /A decorrer/);
  assert.match(board.body, /data-drop="5" data-done/);
});

test('tarefas: lixeira (restaurar, apagar de vez, esvaziar, 30 dias) e arquivo (14 dias, pesquisa, reabrir)', async () => {
  const { app, db } = await makeApp();
  const hugo = await login(app, 'hugo');
  for (const t of ['Lixo 1', 'Lixo 2', 'Feita antiga', 'Feita recente']) await post(app, '/tarefas', hugo, { title: t, project: t.startsWith('Feita') ? 'MEG' : '' });
  const id = (t) => db.prepare('SELECT id FROM tasks WHERE title = ?').pluck().get(t);
  // Lixeira
  await post(app, `/tarefas/${id('Lixo 1')}/apagar`, hugo, {});
  await post(app, `/tarefas/${id('Lixo 2')}/apagar`, hugo, {});
  let page = await get(app, '/tarefas/lixeira', hugo);
  assert.match(page.body, /Lixo 1/);
  assert.match(page.body, /daqui a 30 dias/);
  assert.match((await get(app, '/tarefas', hugo)).body, /Lixeira <span class="count">2<\/span>/);
  let r = await post(app, `/tarefas/${id('Lixo 1')}/restaurar`, hugo, {});
  assert.match(r.headers.location, /msg=tarefa_restaurada/);
  assert.equal(task(db, id('Lixo 1')).deleted_at, null);
  assert.match((await get(app, '/tarefas', hugo)).body, /Lixo 1/);
  await post(app, `/tarefas/${id('Lixo 2')}/apagar-de-vez`, hugo, {});
  assert.equal(id('Lixo 2'), undefined);
  // Apagar de vez só funciona para o que está na lixeira
  await post(app, `/tarefas/${id('Lixo 1')}/apagar-de-vez`, hugo, {});
  assert.ok(id('Lixo 1'));
  await post(app, `/tarefas/${id('Lixo 1')}/apagar`, hugo, {});
  await post(app, '/tarefas/lixeira/esvaziar', hugo, {});
  assert.equal(id('Lixo 1'), undefined);

  // Arquivo automático das concluídas há mais de 14 dias
  for (const t of ['Feita antiga', 'Feita recente']) await post(app, `/tarefas/${id(t)}/mover`, hugo, { col: 'feito', back: '/tarefas' });
  db.prepare("UPDATE tasks SET done_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 days') WHERE title = 'Feita antiga'").run();
  assert.deepEqual(housekeeping(db), { archived: 1, purged: 0 });
  assert.ok(task(db, id('Feita antiga')).archived_at);
  assert.equal(task(db, id('Feita recente')).archived_at, null);
  const board = await get(app, '/tarefas', hugo);
  assert.ok(!board.body.includes('Feita antiga'));
  assert.match(board.body, /Feita recente/);
  // Arquivar à mão, pesquisar, reabrir
  await post(app, `/tarefas/${id('Feita recente')}/arquivar`, hugo, { back: '/tarefas' });
  page = await get(app, '/tarefas/arquivo?q=antiga', hugo);
  assert.match(page.body, /Feita antiga/);
  assert.ok(!page.body.includes('Feita recente'));
  assert.match((await get(app, '/tarefas/arquivo?projeto=MEG', hugo)).body, /Feita recente/);
  r = await post(app, `/tarefas/${id('Feita antiga')}/restaurar`, hugo, {});
  assert.match(r.headers.location, /msg=tarefa_reaberta/);
  const back = task(db, id('Feita antiga'));
  assert.equal(back.archived_at, null);
  assert.equal(back.done_at, null);
  assert.equal(back.column_id, 1);

  // Lixeira antiga apagada de vez ao fim de 30 dias
  await post(app, `/tarefas/${id('Feita antiga')}/apagar`, hugo, {});
  db.prepare("UPDATE tasks SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-31 days') WHERE title = 'Feita antiga'").run();
  assert.equal(housekeeping(db).purged, 1);
  assert.equal(id('Feita antiga'), undefined);
});

test('tarefas: checklist com progresso no cartão e pesquisa no arquivo', async () => {
  const { app, db } = await makeApp();
  const hugo = await login(app, 'hugo');
  await post(app, '/tarefas', hugo, { title: 'Preparar sessão MEG' });
  const id = db.prepare('SELECT id FROM tasks').pluck().get();
  for (const t of ['Calibrar', 'Imprimir consentimento', 'Confirmar sala']) await post(app, `/tarefas/${id}/itens`, hugo, { text: t });
  assert.equal((await post(app, `/tarefas/${id}/itens`, hugo, { text: '  ' })).headers.location.includes('err='), true);
  const items = db.prepare('SELECT id FROM task_items WHERE task_id = ? ORDER BY position').pluck().all(id);
  assert.equal(items.length, 3);
  let r = await post(app, `/tarefas/${id}/itens/${items[0]}`, hugo, { done: '1', ajax: '1' });
  assert.deepEqual(JSON.parse(r.body), { ok: true });
  await post(app, `/tarefas/${id}/itens/${items[1]}`, hugo, { done: '1' });
  assert.match((await get(app, '/tarefas', hugo)).body, /2\/3/);
  const page = await get(app, `/tarefas/${id}`, hugo);
  assert.match(page.body, /data-check-count data-format="fracao">2\/3/);
  assert.match(page.body, /aria-checked="true"/);
  assert.match(page.body, /class="w65"/);
  await post(app, `/tarefas/${id}/itens/${items[2]}/apagar`, hugo, {});
  assert.match((await get(app, '/tarefas', hugo)).body, /tk-check all[^>]*>.*?2\/2/s);
  // Item de outra tarefa: não mexe
  assert.equal((await post(app, `/tarefas/9999/itens/${items[0]}`, hugo, { done: '0', ajax: '1' })).statusCode, 400);
  // Pesquisa no arquivo encontra pelo texto da checklist; apagar a tarefa apaga os itens
  await post(app, `/tarefas/${id}/arquivar`, hugo, {});
  assert.match((await get(app, '/tarefas/arquivo?q=consentimento', hugo)).body, /Preparar sessão MEG/);
  await post(app, `/tarefas/${id}/apagar`, hugo, {});
  await post(app, '/tarefas/lixeira/esvaziar', hugo, {});
  assert.equal(db.prepare('SELECT COUNT(*) FROM task_items').pluck().get(), 0);
});

test('tarefas: definições (progresso em %, mostrar em Hoje, dias de arquivo e lixeira)', async () => {
  const { app, db } = await makeApp();
  const hugo = await login(app, 'hugo');
  const board = await get(app, '/tarefas', hugo);
  assert.match(board.body, /href="\/tarefas\/definicoes" aria-label="Definições das tarefas"/);
  assert.ok(!board.body.includes('>Colunas</a>'));
  await post(app, '/tarefas', hugo, { title: 'Com checklist', due_date: dmy(todayLocal()) });
  const id = db.prepare('SELECT id FROM tasks').pluck().get();
  for (const t of ['a', 'b', 'c']) await post(app, `/tarefas/${id}/itens`, hugo, { text: t });
  const it = db.prepare('SELECT id FROM task_items ORDER BY id').pluck().all();
  await post(app, `/tarefas/${id}/itens/${it[0]}`, hugo, { done: '1' });
  await post(app, `/tarefas/${id}/itens/${it[1]}`, hugo, { done: '1' });
  // Percentagem
  let r = await post(app, '/tarefas/definicoes', hugo, { task_progress: 'percent', tasks_archive_days: '7', tasks_trash_days: '10', tasks_in_today: '1' });
  assert.match(r.headers.location, /msg=guardado/);
  assert.match((await get(app, '/tarefas', hugo)).body, /67%/);
  assert.match((await get(app, `/tarefas/${id}`, hugo)).body, /data-format="percent">67%/);
  await post(app, '/tarefas/definicoes', hugo, { task_progress: 'ambos', tasks_archive_days: '7', tasks_trash_days: '10', tasks_in_today: '1' });
  assert.match((await get(app, '/tarefas', hugo)).body, /2\/3 · 67%/);
  assert.match((await get(app, '/tarefas/lixeira', hugo)).body, /ficam aqui 10 dias/);
  // Arquivar ao fim de 7 dias
  await post(app, `/tarefas/${id}/mover`, hugo, { col: 'feito', back: '/tarefas' });
  db.prepare("UPDATE tasks SET done_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days')").run();
  assert.equal(housekeeping(db).archived, 1);
  // Não mostrar em Hoje
  await post(app, '/tarefas', hugo, { title: 'Prazo hoje', due_date: dmy(todayLocal()) });
  assert.match((await get(app, '/hoje', hugo)).body, /Tarefas para hoje/);
  await post(app, '/tarefas/definicoes', hugo, { task_progress: 'fracao', tasks_archive_days: '0', tasks_trash_days: '30' });
  const hoje = await get(app, '/hoje', hugo);
  assert.ok(!hoje.body.includes('Tarefas para hoje'));
  assert.ok(!/Tarefas<\/span><span class="count/.test(hoje.body));
  // Valores fora dos limites
  assert.match((await post(app, '/tarefas/definicoes', hugo, { task_progress: 'x', tasks_archive_days: '7', tasks_trash_days: '10' })).headers.location, /err=/);
  assert.match((await post(app, '/tarefas/definicoes', hugo, { task_progress: 'fracao', tasks_archive_days: '7', tasks_trash_days: '0' })).headers.location, /err=/);
});

test('datas dd/mm/aa: 20aa por omissão; nascimento no século certo', async () => {
  const { app, db } = await makeApp();
  const hugo = await login(app, 'hugo');
  const t = addDays(todayLocal(), 3);
  await post(app, '/tarefas', hugo, { title: 'Ano curto', due_date: `${t.slice(8, 10)}/${t.slice(5, 7)}/${t.slice(2, 4)}` });
  assert.equal(db.prepare("SELECT due_date FROM tasks WHERE title = 'Ano curto'").pluck().get(), t);
  const oct = db.prepare("SELECT id FROM exam_types WHERE code = 'oct'").pluck().get();
  await post(app, '/pedidos', hugo, { patient_process: '1', origin: 'externo', priority: 'normal', exam_type_id: String(oct), birth_date: '03/05/58' });
  await post(app, '/pedidos', hugo, { patient_process: '2', origin: 'externo', priority: 'normal', exam_type_id: String(oct), birth_date: '03/05/15' });
  assert.deepEqual(db.prepare('SELECT birth_date FROM requests ORDER BY id').pluck().all(), ['1958-05-03', '2015-05-03']);
  assert.match((await get(app, '/pedidos/novo', hugo)).body, /name="birth_date"[^>]*data-date="past"/);
});

test('notas em Markdown: títulos, listas, links seguros, sem HTML', async () => {
  const { renderMarkdown } = await import('../src/markdown.js');
  const h = renderMarkdown('# Protocolo\n## Passos\n### Detalhe\n###### Pequeno\n**negrito** e *itálico*\n\n- um\n  - um.a\n- [x] feito\n- [ ] por fazer\n\n1. primeiro\n\n[site](https://uc.pt/a?b=1&c=2) <img src=x onerror=alert(1)> [x](javascript:alert(1))');
  assert.match(h, /<h2 class="md-h1">Protocolo<\/h2>/);
  assert.match(h, /<h3 class="md-h2">Passos<\/h3>/);
  assert.match(h, /<h4 class="md-h3">Detalhe<\/h4>/);
  assert.match(h, /<h6 class="md-h6">Pequeno<\/h6>/);
  assert.match(h, /<strong>negrito<\/strong> e <em>itálico<\/em>/);
  assert.match(h, /<li>um<ul><li>um\.a<\/li><\/ul><\/li>/);
  assert.match(h, /md-task done/);
  assert.match(h, /<ol><li>primeiro<\/li><\/ol>/);
  assert.match(h, /<a href="https:\/\/uc\.pt\/a\?b=1&amp;c=2" rel="noopener noreferrer" target="_blank">site<\/a>/);
  assert.ok(!h.includes('<img'));
  assert.ok(!h.includes('href="javascript'));

  const { app, db } = await makeApp();
  const hugo = await login(app, 'hugo');
  await post(app, '/tarefas', hugo, { title: 'Com notas', notes: '# Plano\n- **ler**\n<script>x()</script>' });
  const id = db.prepare('SELECT id FROM tasks').pluck().get();
  const page = await get(app, `/tarefas/${id}`, hugo);
  assert.match(page.body, /data-notes-view><h2 class="md-h1">Plano<\/h2>/);
  assert.match(page.body, /<li><strong>ler<\/strong><\/li>/);
  assert.ok(!page.body.includes('<script>x()'));
  assert.match(page.body, /data-notes-edit/);
  // O texto original continua no campo para editar
  assert.match(page.body, /<textarea[^>]*name="notes"[^>]*># Plano/);
  assert.match(page.body, /role="toolbar" aria-label="Formatação das notas"/);
  assert.match(page.body, /data-md="h1"/);
});
