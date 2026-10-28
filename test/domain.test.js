import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSlot, freeSlots, capacityMinutes } from '../src/domain/slots.js';
import { canTransition } from '../src/domain/status.js';
import { evaluate, formFromTemplate, normFor, parseReportForm, renderReport, suggestConclusion, techniqueSentence, unknownMarkers } from '../src/domain/reports.js';
import { addMinutes, localToUtc, mondayOf, ageAt } from '../src/time.js';
import { buildIcs } from '../src/ics.js';

const TUE = '2027-03-02'; // terça-feira
const ctx = {
  availability: [{ weekday: 2, start: '09:00', end: '12:30' }],
  step: 15,
  busy: [],
  blocks: [],
  maxElectro: 2,
  now: '2027-03-01T10:00',
};

test('vaga dentro do horário é aceite e arredonda a duração à grelha', () => {
  const r = checkSlot(`${TUE}T09:00`, 20, 1, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.end, `${TUE}T09:30`);
});

test('recusa fora do horário, no passado, desalinhada', () => {
  assert.equal(checkSlot(`${TUE}T11:30`, 90, false, ctx).reason, 'fora_horario');
  assert.equal(checkSlot('2027-03-03T09:00', 20, false, ctx).reason, 'fora_horario'); // quarta
  assert.equal(checkSlot('2027-02-23T09:00', 20, false, ctx).reason, 'passado');
  assert.equal(checkSlot(`${TUE}T09:05`, 20, false, ctx).reason, 'desalinhado');
});

test('recusa sobreposição e bloqueios', () => {
  const busy = [{ id: 1, starts_at: `${TUE}T09:00`, ends_at: `${TUE}T10:30`, is_electro: 1 }];
  assert.equal(checkSlot(`${TUE}T10:15`, 20, false, { ...ctx, busy }).reason, 'sobreposicao');
  assert.equal(checkSlot(`${TUE}T10:30`, 20, false, { ...ctx, busy }).ok, true); // encosta, não sobrepõe
  assert.equal(checkSlot(`${TUE}T10:15`, 20, false, { ...ctx, busy, ignoreExamId: 1 }).ok, true); // reagendar o próprio
  const blocks = [{ starts_at: `${TUE}T00:00`, ends_at: '2027-03-03T00:00' }];
  assert.equal(checkSlot(`${TUE}T09:00`, 20, false, { ...ctx, blocks }).reason, 'bloqueado');
});

test('máximo por dia de cada ato', () => {
  const busy = [
    { id: 1, starts_at: `${TUE}T09:00`, ends_at: `${TUE}T10:30`, exam_type_id: 7 },
    { id: 2, starts_at: `${TUE}T10:30`, ends_at: `${TUE}T11:30`, exam_type_id: 7 },
  ];
  const c = { ...ctx, busy, maxPerDay: { 7: 2 } };
  assert.equal(checkSlot(`${TUE}T11:30`, 60, 7, c).reason, 'limite_dia');
  assert.equal(checkSlot(`${TUE}T11:30`, 60, 8, c).ok, true); // outro ato, sem limite
  assert.equal(checkSlot(`${TUE}T11:30`, 60, 7, { ...c, ignoreExamId: 2 }).ok, true); // mudar a hora do próprio
});

test('freeSlots lista as horas possíveis', () => {
  const days = freeSlots({ fromDate: TUE, days: 7, minutes: 90, typeId: 1, ...ctx });
  assert.equal(days.length, 1);
  assert.deepEqual(days[0].times, ['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00']);
  assert.equal(capacityMinutes(ctx.availability, '2027-03-01', '2027-03-08'), 210);
});

test('máquina de estados', () => {
  assert.equal(canTransition('realizado', 'agendado'), true);
  assert.equal(canTransition('realizado', 'por_agendar'), false);
  assert.equal(canTransition('confirmar', 'pendente', 'secretariado'), true);
  assert.equal(canTransition('realizado', 'pendente', 'secretariado'), false); // tem de ser confirmada antes
  assert.equal(canTransition('desmarcar', 'agendado', 'direto'), true);
  assert.equal(canTransition('desmarcar', 'agendado', 'secretariado'), false); // reservas canceladas, não «por agendar»
  assert.equal(canTransition('cancelar', 'realizado', 'ortoptista'), false);
});

test('datas: hora de Lisboa para UTC, incluindo mudança de hora', () => {
  assert.equal(localToUtc('2027-01-15T09:00').toISOString(), '2027-01-15T09:00:00.000Z'); // inverno, UTC+0
  assert.equal(localToUtc('2027-07-15T09:00').toISOString(), '2027-07-15T08:00:00.000Z'); // verão, UTC+1
  assert.equal(localToUtc('2027-03-28T09:00').toISOString(), '2027-03-28T08:00:00.000Z'); // dia da mudança
  assert.equal(addMinutes('2027-03-02T23:30', 45), '2027-03-03T00:15');
  assert.equal(mondayOf('2027-03-07'), '2027-03-01'); // domingo -> segunda anterior
  assert.equal(ageAt('2000-03-03', '2027-03-02'), 26);
});

test('relatório: aceita vírgula decimal e assinala valores inválidos', () => {
  const tpl = formFromTemplate('erg');
  const { data, errors } = parseReportForm(tpl, {
    'f.da3_b_amp.OD': '412,5', 'f.da3_b_amp.OE': '398', 'f.flk_amp.OD': 'abc', 'f.eletrodos': 'DTL', 'f.cooperacao': 'inventada',
  });
  assert.equal(data.da3_b_amp.OD, 412.5);
  assert.equal(data.da3_b_amp.OE, 398);
  assert.ok(errors['f.flk_amp.OD']);
  assert.ok(errors['f.cooperacao']);
  assert.equal(data.eletrodos, 'DTL');
});

test('relatório: normativos da ficha (convertidos dos antigos) e sugestão de conclusão', () => {
  const form = formFromTemplate('erg', { 'erg.da3_b_amp': { min: 350, max: null } });
  const data = { da3_b_amp: { OD: 412, OE: 300 } };
  const { findings } = evaluate(form, data, 40);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].eye, 'OE');
  assert.match(suggestConclusion(form, data, 40), /abaixo do normativo/);
  assert.equal(suggestConclusion(formFromTemplate('erg'), data, 40), ''); // sem normativos, sem sugestão
});

test('normativos por idade: aplica o intervalo da idade; sem idade, só o intervalo geral', () => {
  const f = { type: 'number', norms: [
    { ageMin: null, ageMax: 18, min: 200, max: null },
    { ageMin: 18, ageMax: 60, min: 300, max: 600 },
    { ageMin: 60, ageMax: null, min: 250, max: null },
  ] };
  assert.equal(normFor(f, 10).min, 200);
  assert.equal(normFor(f, 18).min, 300); // «de» incluída
  assert.equal(normFor(f, 59).max, 600);
  assert.equal(normFor(f, 60).min, 250);
  assert.equal(normFor(f, null), null); // sem data de nascimento não se adivinha
  assert.equal(normFor({ type: 'number', norms: [...f.norms, { ageMin: null, ageMax: null, min: 1, max: 2 }] }, null).min, 1);
  const form = { title: 'X', technique: { text: '', fields: [] }, sections: [{ title: 'S', fields: [{ key: 'a', label: 'A', unit: '', type: 'number', eyes: false, options: [], norms: f.norms }] }] };
  assert.equal(evaluate(form, { a: 280 }, 10).findings.length, 0);
  assert.equal(evaluate(form, { a: 280 }, 30).findings.length, 1);
});

test('frase de técnica com marcadores e partes opcionais', () => {
  const t = 'Exame[ com elétrodos {el}][ e {min} min de adaptação]. [Colaboração {coop}.]';
  assert.equal(techniqueSentence(t, { el: 'DTL', min: 20, coop: 'boa' }), 'Exame com elétrodos DTL e 20 min de adaptação. Colaboração boa.');
  assert.equal(techniqueSentence(t, { el: 'DTL' }), 'Exame com elétrodos DTL.');
  assert.equal(techniqueSentence('Valor {x}.', { x: 12.5 }), 'Valor 12,5.');
  assert.deepEqual(unknownMarkers('Usa {el} e {nada}', { technique: { fields: [{ key: 'el' }] }, sections: [] }), ['nada']);
});

test('relatório: escapa HTML em todos os campos', () => {
  const out = String(renderReport({
    form: formFromTemplate('oct'),
    data: { obs: { OD: '<img src=x onerror=alert(1)>' } },
    conclusion: '<script>alert(1)</script>',
    exam: { id: 1, starts_at: '2027-03-02T09:00' },
    request: { patient_process: '123', patient_name: '<b>X</b>', origin: 'externo', birth_date: null, referrer: '' },
    examType: { name: 'OCT' },
    settings: { report_header: ['<i>h</i>'], norms: {} },
  }));
  assert.ok(!out.includes('<script>'));
  assert.ok(!out.includes('<img'));
  assert.ok(!out.includes('<b>X</b>'));
  assert.ok(out.includes('&lt;script&gt;'));
});

test('ICS sem dados de doentes e com datas em UTC', () => {
  const ics = buildIcs({
    exams: [{ id: 7, starts_at: '2027-07-15T09:00', ends_at: '2027-07-15T10:30', type_name: 'ERG campo total', origin: 'externo', status: 'agendado', patient_name: 'Maria Silva' }],
    blocks: [],
    host: 'ortoptica.local',
  });
  assert.match(ics, /DTSTART:20270715T080000Z/);
  assert.ok(!ics.includes('Maria'));
  assert.ok(ics.includes('\r\n'));
});

import { dayTape, freeIntervals, fmtDuration, periods } from '../src/domain/tape.js';
import { examTrack } from '../src/domain/status.js';

test('fita do dia: livres entre exames e bloqueios, dentro do horário', () => {
  assert.deepEqual(freeIntervals(540, 750, [[540, 630], [660, 690]]), [[630, 660], [690, 750]]);
  const t = dayTape({
    date: '2030-01-08',
    windows: [{ start: '09:00', end: '12:30' }],
    exams: [
      { status: 'agendado', starts_at: '2030-01-08T09:00', ends_at: '2030-01-08T10:30' },
      { status: 'faltou', starts_at: '2030-01-08T11:30', ends_at: '2030-01-08T12:00' },
    ],
    blocks: [{ starts_at: '2030-01-08T10:30', ends_at: '2030-01-08T11:00', reason: 'Reunião' }],
    step: 15,
  });
  assert.deepEqual(t.items.map((i) => `${i.kind}@${i.start}`), ['exam@09:00', 'block@10:30', 'gap@11:00', 'exam@11:30']);
  assert.equal(t.freeMinutes, 90); // a falta liberta o tempo
  assert.equal(fmtDuration(90), '1 h 30');
  assert.equal(fmtDuration(45), '45 min');
  // Livre que já passou não conta como disponível
  const past = dayTape({ date: '2030-01-08', windows: [{ start: '09:00', end: '10:00' }], step: 15, nowTime: '11:00' });
  assert.equal(past.freeMinutes, 0);
  assert.ok(past.items[0].past);
});

test('percurso do exame: estações e resumo', () => {
  const today = '2030-01-08';
  assert.equal(examTrack({ status: 'por_agendar' }, today).summary, 'Por agendar');
  // Circuito do secretariado: 4 estações, a primeira é a confirmação
  const p = examTrack({ status: 'pendente', source: 'secretariado', starts_at: '2030-01-10T09:00' }, today);
  assert.equal(p.stations.length, 4);
  assert.deepEqual(p.states, ['next', 'todo', 'todo', 'todo']);
  assert.equal(p.summary, 'Por confirmar');
  assert.equal(examTrack({ status: 'agendado', source: 'secretariado', starts_at: '2030-01-10T09:00' }, today).summary, 'Confirmado');
  assert.equal(examTrack({ status: 'agendado', source: 'secretariado', starts_at: '2030-01-10T09:00', change_kind: 'mover' }, today).summary, 'Alteração de hora pedida');
  assert.equal(examTrack({ status: 'recusado', source: 'secretariado' }, today).tone, 'fail');
  const a = examTrack({ status: 'agendado', starts_at: '2030-01-10T09:00' }, today);
  assert.deepEqual(a.states, ['done', 'next', 'todo', 'todo', 'todo']);
  assert.equal(a.summary, 'Por marcar no Siima');
  assert.equal(examTrack({ status: 'agendado', starts_at: '2030-01-08T09:00', siima_booked_at: 'x' }, today).summary, 'Por realizar');
  const r = examTrack({ status: 'realizado', starts_at: '2030-01-07T09:00', siima_booked_at: 'x', report_status: 'rascunho' }, today);
  assert.deepEqual(r.states, ['done', 'done', 'done', 'draft', 'next']);
  assert.equal(r.summary, 'Falta relatório em rascunho e executar no Siima');
  const f = examTrack({ status: 'realizado', starts_at: '2030-01-07T09:00', siima_booked_at: 'x', report_status: 'validado', siima_registered_at: 'y' }, today);
  assert.equal(f.summary, 'Concluído');
  assert.equal(examTrack({ status: 'faltou', starts_at: '2030-01-07T09:00' }, today).tone, 'fail');
});

test('fita: hora proposta numa alteração ocupa tempo; períodos manhã/tarde com almoço', () => {
  const windows = [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }];
  const hold = { id: 9, type_name: 'OCT', starts_at: '2030-01-09T09:00', change_starts_at: '2030-01-08T14:00', change_ends_at: '2030-01-08T14:30' };
  const exam = { id: 1, status: 'agendado', starts_at: '2030-01-08T09:00', ends_at: '2030-01-08T10:30' };
  const t = dayTape({ date: '2030-01-08', windows, exams: [exam], holds: [hold], step: 15 });
  assert.ok(t.items.some((i) => i.kind === 'hold' && i.start === '14:00'));
  assert.equal(t.freeMinutes, 150 + 150); // manhã 10:30–13:00, tarde 14:30–17:00
  const ps = periods(t, windows);
  assert.deepEqual(ps.map((x) => x.label), ['Manhã', 'Tarde']);
  assert.deepEqual(ps[1].pause, { start: '13:00', end: '14:00' });
  assert.ok(ps[0].items.every((i) => i.start < '13:00'));
  assert.ok(ps[1].items.some((i) => i.kind === 'hold'));
});

test('vagas não atravessam o almoço', () => {
  const lunchCtx = { ...ctx, availability: [{ weekday: 2, start: '09:00', end: '13:00' }, { weekday: 2, start: '14:00', end: '17:00' }] };
  assert.equal(checkSlot(`${TUE}T12:30`, 60, false, lunchCtx).reason, 'fora_horario');
  assert.equal(checkSlot(`${TUE}T14:00`, 60, false, lunchCtx).ok, true);
  const [day] = freeSlots({ fromDate: TUE, days: 1, minutes: 60, typeId: 1, ...lunchCtx });
  assert.ok(!day.times.includes('12:15') && day.times.includes('12:00') && day.times.includes('14:00'));
});

test('datas escritas em dd/mm/aaaa', async () => {
  const { toIsoDate } = await import('../src/time.js');
  assert.equal(toIsoDate('28/10/2026'), '2026-10-28');
  assert.equal(toIsoDate('3/1/2027'), '2027-01-03');
  assert.equal(toIsoDate('2026-10-28'), '2026-10-28');
  assert.equal(toIsoDate(''), '');
  assert.equal(toIsoDate('31/02/2026'), '31/02/2026'); // inválida: a validação recusa
});
