import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, login, post, get, nextWeekday } from './helpers.js';
import { getSetting } from '../src/db.js';
import { counts, setSiimaRegistered } from '../src/repo.js';
import { addDays, todayLocal } from '../src/time.js';

const dmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

async function setup() {
  const { app, db } = await makeApp();
  const types = Object.fromEntries(db.prepare('SELECT code, id FROM exam_types').all().map((t) => [t.code, String(t.id)]));
  const hugo = await login(app, 'hugo');
  const user = { id: db.prepare("SELECT id FROM users WHERE username = 'hugo'").pluck().get() };
  return { app, db, types, hugo, user, base: `/r/${getSetting(db, 'booking_token')}` };
}

const newEval = (app, hugo, types, over = {}) => post(app, '/investigacao', hugo, {
  code: 'NCSF-012', project: 'neuroCSF', typeId: types.aval_visual, date: dmy(nextWeekday(1)), time: '18:00', minutes: '', notes: '', ...over,
});

test('avaliação de investigação: só código do estudo, a qualquer hora, fora do link e do Siima', async () => {
  const { app, db, types, hugo, user, base } = await setup();
  // Tipos de investigação não aparecem nos pedidos clínicos nem no link do secretariado
  assert.ok(!(await get(app, '/pedidos/novo', hugo)).body.includes('Avaliação visual completa'));
  const booking = await get(app, base);
  assert.ok(!booking.body.includes('Avaliação visual completa') && !booking.body.includes('Refração e correção'));
  assert.match((await post(app, `${base}/reservar`, null, { tipo: types.aval_visual, start: `${nextWeekday(2)}T09:00`, quem: 'Marta' })).headers.location, /err=dados_invalidos/);

  // Segunda às 18:00 (fora do horário de exames externos): aceite, já agendada
  const r = await newEval(app, hugo, types);
  assert.equal(r.statusCode, 302);
  const id = Number(r.headers.location.match(/exames\/(\d+)/)[1]);
  const e = db.prepare('SELECT e.*, r.source, r.patient_process, r.patient_name, r.birth_date FROM exams e JOIN requests r ON r.id = e.request_id WHERE e.id = ?').get(id);
  assert.equal(e.status, 'agendado');
  assert.equal(e.source, 'investigacao');
  assert.equal(e.patient_process, 'NCSF-012');
  assert.equal(e.patient_name, '');
  assert.equal(e.birth_date, null);
  assert.equal(e.minutes, 60);
  assert.equal(e.ends_at.slice(11), '19:00');

  const page = await get(app, `/exames/${id}`, hugo);
  assert.match(page.body, /Avaliação de investigação/);
  assert.match(page.body, /Ficha validada/);
  assert.ok(!page.body.includes('Siima'), 'sem passos do Siima');
  assert.ok(!page.body.includes('requisição'), 'sem requisição');

  // Sobreposição com outra avaliação: recusada com a hora do conflito
  const clash = await newEval(app, hugo, types, { code: 'NCSF-013', time: '18:30', minutes: '30' });
  assert.equal(clash.statusCode, 400);
  assert.match(clash.body, /Sobrepõe-se a Avaliação visual completa \(participante\) das 18:00 às 19:00/);

  // Sem projeto ou sem código: recusada
  assert.equal((await newEval(app, hugo, types, { project: '' })).statusCode, 400);
  assert.equal((await newEval(app, hugo, types, { code: '' })).statusCode, 400);

  // Pode registar-se depois de feita (data no passado) e marcar como realizada
  const past = await newEval(app, hugo, types, { code: 'NCSF-001', date: dmy(addDays(todayLocal(), -3)), time: '10:00', typeId: types.refracao_fmri });
  const pastId = Number(past.headers.location.match(/exames\/(\d+)/)[1]);
  await post(app, `/exames/${pastId}/realizado`, hugo, {});
  assert.equal(db.prepare('SELECT status FROM exams WHERE id = ?').pluck().get(pastId), 'realizado');
  // Nunca vai para «executar no Siima»
  assert.equal(counts(db, todayLocal()).porRegistarSiima, 0);
  assert.equal(setSiimaRegistered(db, user, pastId, true).ok, false);
  assert.ok(!(await get(app, '/hoje', hugo)).body.includes('Por executar no Siima</h2><span class="count'));

  // Alterar dia/hora/duração
  const ed = await post(app, `/investigacao/${id}`, hugo, { code: 'NCSF-012', project: 'neuroCSF', typeId: types.aval_visual, date: dmy(nextWeekday(1)), time: '17:00', minutes: '90', notes: 'sessão 2' });
  assert.match(ed.headers.location, /msg=avaliacao_alterada/);
  const after = db.prepare('SELECT starts_at, ends_at, minutes FROM exams WHERE id = ?').get(id);
  assert.equal(after.ends_at.slice(11), '18:30');
  assert.equal(after.minutes, 90);
  // /exames/:id/agendar de uma avaliação leva ao formulário próprio
  assert.match((await get(app, `/exames/${id}/agendar`, hugo)).headers.location, new RegExp(`/investigacao/${id}/editar`));

  // Separador «Investigação» em Pedidos e pesquisa pelo código
  const list = await get(app, '/pedidos?f=investigacao', hugo);
  assert.match(list.body, /NCSF-012/);
  assert.match((await get(app, '/pedidos?q=NCSF-001', hugo)).body, /NCSF-001/);
});

test('avaliação numa manhã de exames externos ocupa a hora no link do secretariado', async () => {
  const { app, types, hugo, base } = await setup();
  const tue = nextWeekday(2);
  const before = await get(app, `${base}?tipo=${types.oct}&semana=${tue}`);
  assert.match(before.body, new RegExp(`value="${tue}T10:00"`));
  await newEval(app, hugo, types, { date: dmy(tue), time: '10:00', minutes: '60' });
  const page = await get(app, `${base}?tipo=${types.oct}&semana=${tue}`);
  assert.ok(!page.body.includes(`value="${tue}T10:00"`) && !page.body.includes(`value="${tue}T10:30"`));
  assert.match(page.body, new RegExp(`value="${tue}T11:00"`));
  // E o secretariado não consegue reservar por cima
  assert.match((await post(app, `${base}/reservar`, null, { tipo: types.oct, start: `${tue}T10:15`, quem: 'Marta' })).headers.location, /err=sobreposicao/);
  // Mas o link não mostra nada da avaliação
  assert.ok(!page.body.includes('NCSF') && !page.body.includes('neuroCSF'));
});

test('estatística: investigação à parte, por projeto e tipo', async () => {
  const { app, db, types, hugo } = await setup();
  const d1 = addDays(todayLocal(), -2);
  for (const [code, time] of [['A-1', '09:00'], ['A-1', '11:00'], ['A-2', '14:00']]) {
    const r = await newEval(app, hugo, types, { code, date: dmy(d1), time, typeId: types.refracao_fmri });
    await post(app, `/exames/${r.headers.location.match(/exames\/(\d+)/)[1]}/realizado`, hugo, {});
  }
  const y = d1.slice(0, 4);
  const s = await get(app, `/estatistica?ano=${y}`, hugo);
  assert.match(s.body, /<h2>Investigação<\/h2>/);
  assert.match(s.body, /<td>neuroCSF<\/td><td>3<\/td><td>2<\/td><td>1,0<\/td>/); // 3 realizadas, 2 participantes, 1 h
  // Não contam como exames clínicos
  assert.match(s.body, /Exames clínicos realizados<\/dt><dd>0/);
  assert.equal(db.prepare("SELECT COUNT(*) FROM exams WHERE status = 'realizado'").pluck().get(), 3);
});

test('relatório: informação clínica, logotipo, e ficha de participante sem dados clínicos', async () => {
  const { app, db, types, hugo } = await setup();
  // Pedido clínico com informação clínica
  const c = await post(app, '/pedidos', hugo, { patient_process: '777', origin: 'externo', priority: 'normal', exam_type_id: types.oct, clinical_info: 'Suspeita de maculopatia OE.' });
  const examId = Number(c.headers.location.match(/exames\/(\d+)/)[1]);
  const reqId = db.prepare('SELECT request_id FROM exams WHERE id = ?').pluck().get(examId);
  db.prepare("UPDATE exams SET status = 'realizado', starts_at = ?, ends_at = ? WHERE id = ?").run(`${addDays(todayLocal(), -1)}T09:00`, `${addDays(todayLocal(), -1)}T09:20`, examId);

  // Logotipo: só imagens pequenas e válidas
  const png = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c80000000049454e44ae426082', 'hex').toString('base64')}`;
  assert.match((await post(app, '/admin/relatorio/logo', hugo, { logo: 'data:text/html;base64,PGgxPg==' })).headers.location, /err=logo_invalido/);
  const evil = `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')}`;
  assert.match((await post(app, '/admin/relatorio/logo', hugo, { logo: evil })).headers.location, /err=logo_invalido/);
  assert.match((await post(app, '/admin/relatorio/logo', hugo, { logo: png })).headers.location, /msg=logo/);
  assert.match((await get(app, '/admin/sistema', hugo)).body, /Logotipo atual/);

  await post(app, `/exames/${examId}/relatorio`, hugo, { acao: 'guardar', conclusion: 'Normal.' });
  const pr = await get(app, `/exames/${examId}/relatorio/imprimir`, hugo);
  assert.match(pr.body, /<h2>Informação clínica<\/h2><p>Suspeita de maculopatia OE\.<\/p>/);
  assert.match(pr.body, /<img class="r-logo" src="data:image\/png;base64,/);
  // Alterar a informação clínica depois
  await post(app, `/pedidos/${reqId}/informacao-clinica`, hugo, { clinical_info: 'Outra suspeita', back: `/exames/${examId}` });
  assert.equal(db.prepare('SELECT clinical_info FROM requests WHERE id = ?').pluck().get(reqId), 'Outra suspeita');

  // Avaliação de investigação: participante e projeto; sem requisição nem assinatura médica
  const r = await newEval(app, hugo, types, { code: 'NCSF-099', date: dmy(addDays(todayLocal(), -1)), time: '15:00', typeId: types.refracao_fmri });
  const rid = Number(r.headers.location.match(/exames\/(\d+)/)[1]);
  await post(app, `/exames/${rid}/realizado`, hugo, {});
  const form = await get(app, `/exames/${rid}/relatorio`, hugo);
  assert.ok(!form.body.includes('Identificar o doente'));
  await post(app, `/exames/${rid}/relatorio`, hugo, { acao: 'guardar', conclusion: 'Refração prescrita.' });
  const rp = await get(app, `/exames/${rid}/relatorio/imprimir`, hugo);
  assert.match(rp.body, /<dt>Participante<\/dt><dd>NCSF-099<\/dd>/);
  assert.match(rp.body, /<dt>Projeto<\/dt><dd>neuroCSF<\/dd>/);
  assert.ok(!rp.body.includes('Interpretação clínica'));
  assert.ok(!rp.body.includes('Informação clínica'));
});

test('mapa semanal: exames clínicos da semana, sem as avaliações de investigação', async () => {
  const { app, types, hugo, base } = await setup();
  const tue = nextWeekday(2);
  await post(app, `${base}/reservar`, null, { tipo: types.oct, start: `${tue}T09:00`, requisicao: 'REQ-1', quem: 'Marta' });
  await newEval(app, hugo, types, { date: dmy(tue), time: '11:00', code: 'NCSF-050' });
  const m = await get(app, `/agenda/mapa?semana=${tue}`, hugo);
  assert.equal(m.statusCode, 200);
  assert.match(m.body, /OCT segmento posterior/);
  assert.match(m.body, /REQ-1/);
  assert.match(m.body, /Marta/);
  assert.match(m.body, /Por confirmar/);
  assert.match(m.body, /1 avaliação de investigação/);
  assert.ok(!m.body.includes('NCSF-050'));
  assert.match(m.body, /data-print/);
  assert.match((await get(app, `/agenda?semana=${tue}`, hugo)).body, /Mapa semanal/);
});

test('administração: avaliações de investigação numa tabela própria; novo tipo de investigação', async () => {
  const { app, db, hugo } = await setup();
  const page = await get(app, '/admin/exames', hugo);
  assert.match(page.body, /id="investigacao"/);
  const r = await post(app, '/admin/exames/novo', hugo, { kind: 'investigacao', name: 'Campimetria para estudo', minutes: '45', from: '' });
  assert.equal(r.statusCode, 302);
  assert.equal(db.prepare("SELECT kind FROM exam_types WHERE name = 'Campimetria para estudo'").pluck().get(), 'investigacao');
  assert.match((await get(app, '/investigacao/nova', hugo)).body, /Campimetria para estudo/);
});
