import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, post, get, nextWeekday, PW } from './helpers.js';
import { getSetting } from '../src/db.js';
import { addDays, todayLocal } from '../src/time.js';

test('sem sessão: páginas redirecionam para o login, POST recusado', async () => {
  const { app } = await makeApp();
  const r = await get(app, '/hoje');
  assert.equal(r.statusCode, 302);
  assert.match(r.headers.location, /^\/login/);
  const p = await post(app, '/pedidos', null, {});
  assert.equal(p.statusCode, 401);
});

test('login: erro genérico, limite de tentativas e cookie seguro', async () => {
  const { app } = await makeApp();
  for (let i = 0; i < 5; i++) {
    const r = await post(app, '/login', null, { username: 'hugo', password: 'errada' });
    assert.equal(r.statusCode, 401);
  }
  const blocked = await post(app, '/login', null, { username: 'hugo', password: PW });
  assert.equal(blocked.statusCode, 429);
  const ok = await post(app, '/login', null, { username: 'sec', password: PW });
  assert.match(ok.headers['set-cookie'], /HttpOnly/);
  assert.match(ok.headers['set-cookie'], /SameSite=Strict/);
});

test('CSRF: POST de outra origem é recusado', async () => {
  const { app } = await makeApp();
  const cookie = await login(app, 'hugo');
  const r = await app.inject({
    method: 'POST', url: '/bloqueios', payload: 'date_from=2030-01-01&reason=x',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://evil.example', host: 'localhost:80', cookie },
  });
  assert.equal(r.statusCode, 403);
});

test('contas antigas do secretariado já não entram nas páginas (usam o link)', async () => {
  const { app } = await makeApp();
  const cookie = await login(app, 'sec');
  for (const url of ['/hoje', '/estatistica', '/admin', '/pedidos', '/exames/1/relatorio']) {
    const r = await get(app, url, cookie);
    assert.equal(r.statusCode, 403, url);
  }
  assert.match((await get(app, '/hoje', cookie)).body, /link de reservas/);
});

test('fora do circuito: pedido → agendar → marcado no Siima → realizado → relatório → executado → estatística', async () => {
  const { app, db } = await makeApp();
  const hugo = await login(app, 'hugo');
  const sec = hugo;
  const types = Object.fromEntries(db.prepare('SELECT code, id FROM exam_types').all().map((t) => [t.code, String(t.id)]));

  // Validação: sem processo e sem exames
  const bad = await post(app, '/pedidos', sec, { origin: 'externo', priority: 'normal' });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.body, /n\.º de processo/);

  // Projeto sem nome do projeto é recusado
  const noProj = await post(app, '/pedidos', sec, { patient_process: '1', origin: 'projeto', priority: 'normal', exam_type_id: types.erg });
  assert.equal(noProj.statusCode, 400);

  // Pedido com um exame segue direto para agendar; nome com HTML é escapado
  const created = await post(app, '/pedidos', sec, {
    patient_process: '12345', patient_name: '<script>alert(1)</script>', birth_date: '1980-05-01',
    origin: 'externo', priority: 'normal', referrer: 'Dr. X', notes: '', project: '', exam_type_id: types.erg,
  });
  assert.equal(created.statusCode, 302);
  assert.match(created.headers.location, /^\/exames\/\d+\/agendar/);
  const examId = Number(created.headers.location.split('/')[2]);

  const slotsPage = await get(app, `/exames/${examId}/agendar`, sec);
  assert.equal(slotsPage.statusCode, 200);
  assert.ok(!slotsPage.body.includes('<script>alert(1)</script>'));
  assert.ok(slotsPage.body.includes('&lt;script&gt;'));

  const tue = nextWeekday(2);
  const sched = await post(app, `/exames/${examId}/agendar`, sec, { starts_at: `${tue}T09:00` });
  assert.equal(sched.statusCode, 302);
  assert.match(sched.headers.location, /msg=agendado/);

  // Segundo pedido na mesma hora: sobreposição
  const c2 = await post(app, '/pedidos', sec, { patient_process: '999', origin: 'externo', priority: 'normal', exam_type_id: types.pev });
  const exam2 = Number(c2.headers.location.split('/')[2]);
  const clash = await post(app, `/exames/${exam2}/agendar`, sec, { starts_at: `${tue}T09:30` });
  assert.match(clash.headers.location, /err=sobreposicao/);
  // Encostado ao primeiro (ERG 90 min → 10:30): aceite
  assert.match((await post(app, `/exames/${exam2}/agendar`, sec, { starts_at: `${tue}T10:30` })).headers.location, /msg=agendado/);
  // Terceiro exame de eletrofisiologia no mesmo dia: limite
  const c3 = await post(app, '/pedidos', sec, { patient_process: '777', origin: 'externo', priority: 'normal', exam_type_id: types.pev });
  const exam3 = Number(c3.headers.location.split('/')[2]);
  assert.match((await post(app, `/exames/${exam3}/agendar`, sec, { starts_at: `${tue}T11:30` })).headers.location, /err=limite_electro/);
  // Hora inválida
  assert.match((await post(app, `/exames/${exam3}/agendar`, sec, { starts_at: 'amanhã' })).headers.location, /err=hora_invalida/);

  // Marca no Siima
  assert.match((await post(app, `/exames/${examId}/siima-marcado`, sec, { back: '/hoje' })).headers.location, /msg=siima_marcado/);
  // Repetir a mesma ação (duplo clique) não estraga nada
  assert.match((await post(app, `/exames/${examId}/siima-marcado`, sec, { back: '/hoje' })).headers.location, /err=estado/);

  // Exame futuro não pode ser marcado como realizado (clique na linha errada)
  assert.match((await post(app, `/exames/${examId}/realizado`, hugo, { back: '/hoje' })).headers.location, /err=futuro/);
  // Simula que o dia chegou: passa o exame para ontem
  const yesterday = addDays(todayLocal(), -1);
  db.prepare("UPDATE exams SET starts_at = ? || substr(starts_at, 11), ends_at = ? || substr(ends_at, 11) WHERE id = ?").run(yesterday, yesterday, examId);

  // Ortoptista: realizado → aparece em «por executar no Siima»
  assert.match((await post(app, `/exames/${examId}/realizado`, hugo, { back: '/hoje' })).headers.location, /msg=realizado/);
  const today = await get(app, '/hoje', hugo);
  assert.match(today.body, /por executar no Siima/);

  // Relatório: número inválido devolve o formulário com erro, sem perder o resto
  const badRep = await post(app, `/exames/${examId}/relatorio`, hugo, { 'f.da3_b_amp.OD': '41x', 'f.da3_b_amp.OE': '398', acao: 'guardar' });
  assert.equal(badRep.statusCode, 400);
  assert.match(badRep.body, /valores inválidos/);
  assert.match(badRep.body, /value="398"/);

  // Validar sem conclusão: recusado
  const noConc = await post(app, `/exames/${examId}/relatorio`, hugo, { 'f.da3_b_amp.OD': '412,5', acao: 'validar', conclusion: '' });
  assert.equal(noConc.statusCode, 400);

  const val = await post(app, `/exames/${examId}/relatorio`, hugo, {
    'f.eletrodos': 'DTL', 'f.da3_b_amp.OD': '412,5', 'f.da3_b_amp.OE': '398', acao: 'validar', conclusion: 'ERG dentro da normalidade.',
  });
  assert.match(val.headers.location, /msg=validado/);
  const rep = db.prepare('SELECT * FROM reports WHERE exam_id = ?').get(examId);
  assert.equal(rep.status, 'validado');
  assert.match(rep.final_html, /412,5/);
  assert.match(rep.final_html, /Hugo/);

  // Mudar normativos depois não altera o relatório validado
  const before = rep.final_html;
  await post(app, '/admin/normativos', hugo, { modelo: 'erg', 'min.da3_b_amp': '500' });
  assert.deepEqual(getSetting(db, 'norms')['erg.da3_b_amp'], { min: 500, max: null });
  assert.equal(db.prepare('SELECT final_html FROM reports WHERE exam_id = ?').pluck().get(examId), before);

  // Reabrir guarda histórico
  await post(app, `/exames/${examId}/relatorio/reabrir`, hugo);
  assert.equal(db.prepare('SELECT COUNT(*) FROM report_history').pluck().get(), 1);

  // Registar no Siima; depois já não se pode anular «realizado» sem desfazer o registo
  const reg = await post(app, `/exames/${examId}/siima-registado`, hugo, { back: '/hoje#siima' });
  assert.equal(reg.headers.location, `/hoje?msg=siima_registado&u=${examId}#siima`);
  // A mensagem oferece «Desfazer» para esse exame
  const undoPage = await get(app, reg.headers.location.split('#')[0], hugo);
  assert.match(undoPage.body, new RegExp(`action="/exames/${examId}/siima-registado/desfazer"`));
  assert.match((await post(app, `/exames/${examId}/siima-registado/desfazer`, hugo, { back: '/hoje' })).headers.location, /msg=desfeito/);
  assert.match((await post(app, `/exames/${examId}/siima-registado`, hugo, { back: '/hoje' })).headers.location, /msg=siima_registado/);
  assert.match((await post(app, `/exames/${examId}/anular_realizado`, hugo, {})).headers.location, /err=registado/);

  // Estatística e CSV
  const year = yesterday.slice(0, 4);
  const stats = await get(app, `/estatistica?ano=${year}`, hugo);
  assert.equal(stats.statusCode, 200);
  assert.ok(!/€/.test(stats.body), 'sem valores financeiros');
  assert.match(stats.body, /Executados no Siima/);
  const csv = await get(app, `/estatistica/exames.csv?ano=${year}`, hugo);
  assert.ok(csv.body.startsWith('﻿'));
  assert.ok(!csv.body.includes('script')); // nome do doente não vai no CSV
  assert.match(csv.body, /12345/);

  // ICS com token certo e errado
  const token = getSetting(db, 'ics_token');
  const ics = await get(app, `/ics/${token}/agenda.ics`);
  assert.equal(ics.statusCode, 200);
  assert.ok(!ics.body.includes('script'));
  assert.equal((await get(app, '/ics/errado/agenda.ics')).statusCode, 404);

  // Auditoria registou as ações
  const actions = db.prepare("SELECT action FROM audit_log WHERE entity = 'exame' AND entity_id = ?").pluck().all(examId);
  for (const a of ['agendar', 'siima_marcado', 'realizado', 'relatorio_validado', 'siima_registado']) assert.ok(actions.includes(a), a);
});

test('redirecionamento só para caminhos locais', async () => {
  const { app, db } = await makeApp();
  const sec = await login(app, 'hugo');
  const id = db.prepare('SELECT id FROM exam_types LIMIT 1').pluck().get();
  const c = await post(app, '/pedidos', sec, { patient_process: '1', origin: 'externo', priority: 'normal', exam_type_id: String(id) });
  const examId = Number(c.headers.location.split('/')[2]);
  const r = await post(app, `/exames/${examId}/cancelar`, sec, { back: 'https://evil.example/' });
  assert.match(r.headers.location, new RegExp(`^/exames/${examId}\\?msg=cancelado`));
  const l = await post(app, '/login', null, { username: 'hugo', password: PW, next: '//evil.example' });
  assert.equal(l.headers.location, '/hoje');
});

test('cabeçalhos de segurança e no-store em páginas com dados', async () => {
  const { app } = await makeApp();
  const cookie = await login(app, 'hugo');
  const r = await get(app, '/hoje', cookie);
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.ok(!r.body.includes('style="'), 'sem estilos inline (CSP)');
});

test('primeiro acesso obriga a mudar a palavra-passe', async () => {
  const { app, db } = await makeApp();
  db.prepare("UPDATE users SET must_change_password = 1 WHERE username = 'hugo'").run();
  const cookie = await login(app, 'hugo');
  const r = await get(app, '/hoje', cookie);
  assert.equal(r.headers.location, '/conta');
  const weak = await post(app, '/conta', cookie, { current: PW, password: 'curta', password2: 'curta' });
  assert.equal(weak.statusCode, 400);
  const ok = await post(app, '/conta', cookie, { current: PW, password: 'uma-boa-frase-longa', password2: 'uma-boa-frase-longa' });
  assert.equal(ok.statusCode, 302);
  const newCookie = ok.headers['set-cookie'].split(';')[0];
  assert.equal((await get(app, '/hoje', newCookie)).statusCode, 200);
  assert.equal((await get(app, '/hoje', cookie)).statusCode, 302); // sessão antiga terminada
});


test('todas as páginas principais abrem sem erro', async () => {
  const { app } = await makeApp();
  const cookie = await login(app, 'hugo');
  for (const url of ['/hoje', '/agenda', '/pedidos', '/pedidos?f=todos', '/pedidos/novo', '/bloqueios', '/estatistica', '/admin', '/admin/exames',
    '/admin/utilizadores', '/admin/normativos', '/conta', '/aparencia', '/offline', '/manifest.webmanifest', '/temas.css']) {
    const r = await get(app, url, cookie);
    assert.equal(r.statusCode, 200, url);
  }
});
