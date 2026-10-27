import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, post, get, nextWeekday } from './helpers.js';
import { getSetting, setSetting } from '../src/db.js';
import { addDays, todayLocal } from '../src/time.js';
import { notify, saveSubscription } from '../src/push.js';

const exam = (db, id) => db.prepare('SELECT * FROM exams WHERE id = ?').get(id);

async function setup() {
  const { app, db } = await makeApp();
  const token = getSetting(db, 'booking_token');
  const types = Object.fromEntries(db.prepare('SELECT code, id FROM exam_types').all().map((t) => [t.code, String(t.id)]));
  return { app, db, base: `/r/${token}`, types, hugo: await login(app, 'hugo') };
}

test('link de reservas: token errado não mostra nada; certo mostra vagas sem dados de doentes', async () => {
  const { app, db, base, types } = await setup();
  assert.equal((await get(app, '/r/errado')).statusCode, 404);
  assert.equal((await post(app, '/r/errado/reservar', null, { tipo: types.oct, start: '2030-01-01T09:00', quem: 'Marta' })).statusCode, 404);
  // Pedido fora do circuito com nome de doente: não pode aparecer no link
  const hugo = await login(app, 'hugo');
  await post(app, '/pedidos', hugo, { patient_process: '55555', patient_name: 'Maria Doente', origin: 'externo', priority: 'normal', exam_type_id: types.oct });
  const page = await get(app, `${base}?tipo=${types.oct}`);
  assert.equal(page.statusCode, 200);
  assert.ok(!page.body.includes('Maria Doente') && !page.body.includes('55555'));
  assert.match(page.body, /class="slot"/);
  assert.match(page.body, /Manhã/);
  assert.match(page.body, /Tarde/);
  assert.ok(!page.body.includes('style="'), 'sem estilos inline (CSP)');
  assert.ok(!page.body.includes('class="nav"'), 'sem navegação interna');
  // Gerar link novo invalida o antigo
  await post(app, '/admin/reservas/link', hugo);
  assert.equal((await get(app, base)).statusCode, 404);
  assert.equal((await get(app, `/r/${getSetting(db, 'booking_token')}`)).statusCode, 200);
});

test('reserva → confirmar (com requisição) → pedido de alteração → aceitar; a hora proposta fica reservada', async () => {
  const { app, db, base, types, hugo } = await setup();
  const tue = nextWeekday(2);
  // Sem nome: recusado
  assert.match((await post(app, `${base}/reservar`, null, { tipo: types.oct, start: `${tue}T09:00` })).headers.location, /err=sem_nome/);
  // Com lista de nomes, só nomes da lista
  setSetting(db, 'booking_names', ['Marta', 'Rita']);
  assert.match((await post(app, `${base}/reservar`, null, { tipo: types.oct, start: `${tue}T09:00`, quem: 'Intruso' })).headers.location, /err=sem_nome/);

  const r = await post(app, `${base}/reservar`, null, { tipo: types.oct, start: `${tue}T09:00`, quem: 'Marta' });
  assert.equal(r.statusCode, 302);
  assert.match(r.headers.location, /\/reservas\/\d+\?msg=reservado/);
  assert.match(r.headers['set-cookie'], /quem=Marta/);
  const id = Number(r.headers.location.match(/reservas\/(\d+)/)[1]);
  assert.equal(exam(db, id).status, 'pendente');
  // Pendente já ocupa a vaga
  assert.match((await post(app, `${base}/reservar`, null, { tipo: types.oct, start: `${tue}T09:00`, quem: 'Rita' })).headers.location, /err=sobreposicao/);
  // Almoço nunca tem vagas
  assert.match((await post(app, `${base}/reservar`, null, { tipo: types.erg, start: `${tue}T12:00`, quem: 'Rita' })).headers.location, /err=fora_horario/);

  // O ortoptista vê-a em «Por confirmar» e o contador sobe
  const hoje = await get(app, '/hoje', hugo);
  assert.match(hoje.body, /id="confirmar"/);
  assert.match(hoje.body, /por Marta/);
  // Confirmar sem requisição: recusado; com requisição: confirmado
  assert.match((await post(app, `/exames/${id}/confirmar`, hugo, { back: '/hoje' })).headers.location, /err=sem_requisicao/);
  assert.match((await post(app, `/exames/${id}/confirmar`, hugo, { back: '/hoje', requisition: 'R-123' })).headers.location, /msg=confirmado/);
  assert.equal(exam(db, id).status, 'agendado');
  assert.equal(exam(db, id).requisition, 'R-123');
  assert.match((await get(app, `${base}/reservas/${id}`)).body, /Confirmado/);

  // Já confirmada: mudar a hora passa a ser um pedido; a hora nova fica reservada
  const mv = await post(app, `${base}/reservas/${id}/mover`, null, { start: `${tue}T14:00`, quem: 'Rita' });
  assert.match(mv.headers.location, /msg=pedido_alteracao/);
  let e = exam(db, id);
  assert.equal(e.change_kind, 'mover');
  assert.equal(e.starts_at, `${tue}T09:00`); // mantém-se até decidir
  assert.match((await post(app, `${base}/reservar`, null, { tipo: types.oct, start: `${tue}T14:00`, quem: 'Marta' })).headers.location, /err=sobreposicao/);
  // Só um pedido de cada vez
  assert.match((await post(app, `${base}/reservas/${id}/cancelar`, null, { quem: 'Rita' })).headers.location, /err=estado/);
  // Aceitar: passa para a hora nova e liberta a antiga
  assert.match((await post(app, `/exames/${id}/alteracao/aceitar`, hugo, { back: '/hoje' })).headers.location, /msg=alteracao_aceite/);
  e = exam(db, id);
  assert.equal(e.starts_at, `${tue}T14:00`);
  assert.equal(e.change_kind, null);
  assert.match((await post(app, `${base}/reservar`, null, { tipo: types.oct, start: `${tue}T09:00`, quem: 'Marta' })).headers.location, /msg=reservado/);

  // Pedido de cancelamento recusado com motivo: o secretariado vê o motivo
  await post(app, `${base}/reservas/${id}/cancelar`, null, { quem: 'Marta' });
  assert.equal(exam(db, id).change_kind, 'cancelar');
  await post(app, `/exames/${id}/alteracao/recusar`, hugo, { back: '/hoje', note: 'Doente já avisado' });
  assert.equal(exam(db, id).status, 'agendado');
  assert.match((await get(app, `${base}/reservas/${id}`)).body, /Doente já avisado/);

  // Retirar um pedido ainda não decidido
  await post(app, `${base}/reservas/${id}/cancelar`, null, { quem: 'Marta' });
  assert.match((await post(app, `${base}/reservas/${id}/retirar`, null, {})).headers.location, /msg=pedido_retirado/);
  assert.equal(exam(db, id).change_kind, null);

  // Histórico regista quem fez o quê
  const actions = db.prepare("SELECT action FROM audit_log WHERE entity = 'exame' AND entity_id = ?").pluck().all(id);
  for (const a of ['reservar', 'confirmar', 'pedir_alteracao', 'aceitar_alteracao', 'pedir_cancelamento', 'recusar_alteracao', 'retirar_pedido']) assert.ok(actions.includes(a), a);
});

test('reserva por confirmar: muda ou anula logo; recusar liberta a vaga e mostra o motivo', async () => {
  const { app, db, base, types, hugo } = await setup();
  const thu = nextWeekday(4);
  const id = Number((await post(app, `${base}/reservar`, null, { tipo: types.pev, start: `${thu}T09:00`, quem: 'Marta', requisicao: 'R-9' })).headers.location.match(/reservas\/(\d+)/)[1]);
  assert.match((await post(app, `${base}/reservas/${id}/mover`, null, { start: `${thu}T10:00`, quem: 'Marta' })).headers.location, /msg=reserva_mudada/);
  assert.equal(exam(db, id).starts_at, `${thu}T10:00`);
  assert.equal(exam(db, id).status, 'pendente');
  assert.match((await post(app, `${base}/reservas/${id}/cancelar`, null, { quem: 'Marta' })).headers.location, /msg=reserva_anulada/);
  assert.equal(exam(db, id).status, 'cancelado');

  const id2 = Number((await post(app, `${base}/reservar`, null, { tipo: types.pev, start: `${thu}T09:00`, quem: 'Marta' })).headers.location.match(/reservas\/(\d+)/)[1]);
  await post(app, `/exames/${id2}/recusar`, hugo, { back: '/hoje', note: 'Equipamento em manutenção' });
  assert.equal(exam(db, id2).status, 'recusado');
  assert.match((await get(app, base)).body, /Equipamento em manutenção/);
  assert.match((await post(app, `${base}/reservar`, null, { tipo: types.pev, start: `${thu}T09:00`, quem: 'Marta' })).headers.location, /msg=reservado/);
  // Uma reserva feita pelo link não deixa mexer em exames fora do circuito
  const direct = await post(app, '/pedidos', hugo, { patient_process: '1', origin: 'externo', priority: 'normal', exam_type_id: types.oct });
  const directId = Number(direct.headers.location.split('/')[2]);
  assert.equal((await get(app, `${base}/reservas/${directId}`)).statusCode, 404);
});

test('relatório de uma reserva exige identificar o doente; o ortoptista completa a identificação', async () => {
  const { app, db, base, types, hugo } = await setup();
  const tue = nextWeekday(2);
  const id = Number((await post(app, `${base}/reservar`, null, { tipo: types.oct, start: `${tue}T09:00`, quem: 'Marta', requisicao: 'R-1' })).headers.location.match(/reservas\/(\d+)/)[1]);
  await post(app, `/exames/${id}/confirmar`, hugo, { back: '/hoje' });
  const y = addDays(todayLocal(), -1);
  db.prepare("UPDATE exams SET starts_at = ? || substr(starts_at, 11), ends_at = ? || substr(ends_at, 11) WHERE id = ?").run(y, y, id);
  await post(app, `/exames/${id}/realizado`, hugo, { back: '/hoje' });
  const page = await get(app, `/exames/${id}`, hugo);
  assert.match(page.body, /Executado no Siima/);
  assert.ok(!page.body.includes('Marcado no Siima'), 'reservas do secretariado não têm o passo de marcação');
  assert.match(page.body, /Identificar o doente/);
  const noId = await post(app, `/exames/${id}/relatorio`, hugo, { acao: 'validar', conclusion: 'Normal.' });
  assert.equal(noId.statusCode, 400);
  assert.match(noId.body, /Identifique o doente/);
  const reqId = exam(db, id).request_id;
  assert.match((await post(app, `/pedidos/${reqId}/doente`, hugo, { back: `/exames/${id}`, patient_process: '777', patient_name: 'Ana', birth_date: '', origin: 'externo', project: '' })).headers.location, /msg=doente/);
  const ok = await post(app, `/exames/${id}/relatorio`, hugo, { acao: 'validar', conclusion: 'Normal.' });
  assert.match(ok.headers.location, /msg=validado/);
  assert.match(db.prepare('SELECT final_html FROM reports WHERE exam_id = ?').pluck().get(id), /R-1/);
  // Contas novas só de ortoptista
  await post(app, '/admin/utilizadores', hugo, { display_name: 'X', username: 'xsec', role: 'secretariado' });
  assert.equal(db.prepare("SELECT COUNT(*) FROM users WHERE username = 'xsec'").pluck().get(), 0);
});

test('notificações push: guarda a subscrição, envia sem dados de doentes e apaga subscrições mortas', async () => {
  const { db } = await setup();
  assert.equal(saveSubscription(db, 1, { endpoint: 'http://inseguro', keys: { p256dh: 'a', auth: 'b' } }, 'https://x.pt'), false);
  assert.ok(saveSubscription(db, 1, { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } }, 'https://ortoptica.exemplo.pt'));
  assert.ok(saveSubscription(db, 1, { endpoint: 'https://push.example/dead', keys: { p256dh: 'p', auth: 'a' } }, 'https://ortoptica.exemplo.pt'));
  assert.equal(getSetting(db, 'push_subject'), 'https://ortoptica.exemplo.pt');
  const sent = [];
  const fake = (sub, payload, opts) => {
    sent.push({ sub, payload: JSON.parse(payload), opts });
    return sub.endpoint.endsWith('dead') ? Promise.reject(Object.assign(new Error('gone'), { statusCode: 410 })) : Promise.resolve();
  };
  const n = await notify(db, { title: 'Nova reserva', body: 'OCT · Ter 03/11, 09:00 · Marta' }, { send: fake });
  assert.equal(n, 1);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].opts.vapidDetails.subject, 'https://ortoptica.exemplo.pt');
  assert.ok(sent[0].opts.vapidDetails.publicKey);
  assert.equal(db.prepare('SELECT COUNT(*) FROM push_subscriptions').pluck().get(), 1);
});

test('rotas de push exigem sessão e aceitam JSON da própria origem', async () => {
  const { app, hugo } = await setup();
  const key = await get(app, '/push/chave', hugo);
  assert.equal(key.statusCode, 200);
  assert.ok(JSON.parse(key.body).key.length > 40);
  assert.equal((await get(app, '/push/chave')).statusCode, 302);
  const sub = await app.inject({
    method: 'POST', url: '/push/subscrever', payload: { endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } },
    headers: { origin: 'http://localhost:80', host: 'localhost:80', cookie: hugo },
  });
  assert.equal(sub.statusCode, 200);
});
