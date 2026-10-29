// Acesso a dados e regras de negócio que mexem na BD. As rotas só chamam estas funções.
// Cada operação de escrita corre numa transação IMMEDIATE: duas reservas para a mesma vaga
// ao mesmo tempo nunca ficam ambas aceites.
import { audit, getSetting } from './db.js';
import { checkFree, checkSlot, roundUp } from './domain/slots.js';
import { BUSY_STATUSES, canTransition, TRANSITIONS } from './domain/status.js';
import { addDays, addMinutes, nowLocal, todayLocal } from './time.js';

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** kind: 'clinico' (atos/MCDTs), 'investigacao' (avaliações de investigação) ou null (todos). */
export function listExamTypes(db, { activeOnly = true, kind = 'clinico' } = {}) {
  const where = [activeOnly ? 'active = 1' : '', kind ? 'kind = ?' : ''].filter(Boolean);
  return db.prepare(`SELECT * FROM exam_types ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY sort, name`).all(...(kind ? [kind] : []));
}

const EXAM_SELECT = `SELECT e.*, t.name AS type_name, t.code AS type_code, t.report_template, t.form AS type_form, t.kind AS type_kind,
  r.source, r.booked_by_name, r.patient_process, r.patient_name, r.birth_date, r.origin, r.project, r.referrer, r.priority, r.notes, r.clinical_info,
  rp.status AS report_status
  FROM exams e
  JOIN exam_types t ON t.id = e.exam_type_id
  JOIN requests r ON r.id = e.request_id
  LEFT JOIN reports rp ON rp.exam_id = e.id`;

export function getExam(db, id) {
  return db.prepare(`${EXAM_SELECT} WHERE e.id = ?`).get(id);
}

export function examsWhere(db, where, params = [], order = 'e.starts_at, e.id', limit = 500) {
  return db.prepare(`${EXAM_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ${Number(limit)}`).all(...params);
}

export function getRequest(db, id) {
  return db.prepare('SELECT r.*, u.display_name AS created_by_name FROM requests r LEFT JOIN users u ON u.id = r.created_by WHERE r.id = ?').get(id);
}

/** Pedido criado pelo ortoptista (fora do circuito): com doente identificado e um ou mais exames. */
export function createRequest(db, user, req, examTypeIds, requisition = '') {
  return db.transaction(() => {
    const info = db.prepare(`INSERT INTO requests (source, patient_process, patient_name, birth_date, origin, project, referrer, priority, notes, clinical_info, created_by)
      VALUES ('direto', @patient_process, @patient_name, @birth_date, @origin, @project, @referrer, @priority, @notes, @clinical_info, @created_by)`)
      .run({ clinical_info: '', ...req, created_by: user.id });
    const requestId = Number(info.lastInsertRowid);
    const getType = db.prepare("SELECT * FROM exam_types WHERE id = ? AND active = 1 AND kind = 'clinico'");
    const ins = db.prepare('INSERT INTO exams (request_id, exam_type_id, minutes, is_electro, requisition) VALUES (?, ?, ?, ?, ?)');
    for (const tid of examTypeIds) {
      const t = getType.get(tid);
      if (!t) throw new Error(`Tipo de exame inválido: ${tid}`);
      ins.run(requestId, t.id, t.minutes, t.is_electro, requisition);
    }
    audit(db, user.id, 'criar', 'pedido', requestId, { exames: examTypeIds.length });
    return requestId;
  }).immediate();
}

/** Identificação do doente (o ortoptista completa-a nas reservas do secretariado). */
export function updatePatient(db, user, requestId, data) {
  const res = db.prepare(`UPDATE requests SET patient_process = @patient_process, patient_name = @patient_name, birth_date = @birth_date,
    origin = @origin, project = @project WHERE id = @id`).run({ ...data, id: requestId });
  if (res.changes) audit(db, user.id, 'alterar_doente', 'pedido', requestId);
  return { ok: res.changes === 1 };
}

/** Informação clínica do requisitante (suspeita/observações), para o relatório. */
export function setClinicalInfo(db, user, requestId, text) {
  const v = String(text || '').trim().slice(0, 2000);
  const res = db.prepare("UPDATE requests SET clinical_info = ? WHERE id = ? AND source <> 'investigacao'").run(v, requestId);
  if (res.changes) audit(db, user.id, 'informacao_clinica', 'pedido', requestId);
  return { ok: res.changes === 1 };
}

// ---------- Investigação ----------

/** Exames/avaliações que ocupam um dia (para verificar sobreposições de uma avaliação). */
function busyOn(db, date) {
  return scheduleContext(db, date, date).busy;
}

/**
 * Nova avaliação de investigação: participante só com o código do estudo. Com data e hora fica
 * logo agendada; a duração é a do tipo, salvo indicação.
 * data: { code, project, typeId, startsAt, minutes, notes }
 */
export function createResearch(db, user, data) {
  return db.transaction(() => {
    const t = db.prepare("SELECT * FROM exam_types WHERE id = ? AND active = 1 AND kind = 'investigacao'").get(data.typeId);
    if (!t) return { ok: false, reason: 'dados_invalidos' };
    const minutes = data.minutes || t.minutes;
    const slot = checkFree(data.startsAt, minutes, { busy: busyOn(db, data.startsAt.slice(0, 10)) });
    if (!slot.ok) return slot;
    const r = db.prepare(`INSERT INTO requests (source, patient_process, origin, project, notes, created_by)
      VALUES ('investigacao', ?, 'projeto', ?, ?, ?)`).run(data.code, data.project, data.notes || '', user.id);
    const requestId = Number(r.lastInsertRowid);
    const info = db.prepare(`INSERT INTO exams (request_id, exam_type_id, status, starts_at, ends_at, minutes, is_electro, confirmed_at)
      VALUES (?, ?, 'agendado', ?, ?, ?, ?, ${NOW_SQL})`).run(requestId, t.id, data.startsAt, slot.end, minutes, t.is_electro);
    const id = Number(info.lastInsertRowid);
    audit(db, user.id, 'criar', 'pedido', requestId, { investigacao: true });
    audit(db, user.id, 'agendar', 'exame', id, { para: data.startsAt });
    return { ok: true, id, requestId };
  }).immediate();
}

/** Mudar dia, hora, duração, tipo ou dados do participante de uma avaliação de investigação. */
export function updateResearch(db, user, examId, data) {
  return db.transaction(() => {
    const exam = db.prepare(`SELECT e.* FROM exams e JOIN requests r ON r.id = e.request_id WHERE e.id = ? AND r.source = 'investigacao'`).get(examId);
    if (!exam) return { ok: false, reason: 'nao_existe' };
    if (['cancelado', 'recusado'].includes(exam.status)) return { ok: false, reason: 'estado' };
    const t = db.prepare("SELECT * FROM exam_types WHERE id = ? AND kind = 'investigacao'").get(data.typeId);
    if (!t) return { ok: false, reason: 'dados_invalidos' };
    // Com ficha já começada, o tipo (e portanto a ficha) não muda.
    const hasReport = db.prepare('SELECT 1 FROM reports WHERE exam_id = ?').get(exam.id);
    if (hasReport && t.id !== exam.exam_type_id) return { ok: false, reason: 'tipo_com_ficha' };
    const slot = checkFree(data.startsAt, data.minutes, { busy: busyOn(db, data.startsAt.slice(0, 10)), ignoreExamId: exam.id });
    if (!slot.ok) return slot;
    db.prepare(`UPDATE exams SET exam_type_id = ?, starts_at = ?, ends_at = ?, minutes = ?, is_electro = ?,
      status = CASE WHEN status = 'por_agendar' THEN 'agendado' ELSE status END, updated_at = ${NOW_SQL} WHERE id = ?`)
      .run(t.id, data.startsAt, slot.end, data.minutes, t.is_electro, exam.id);
    db.prepare('UPDATE requests SET patient_process = ?, project = ?, notes = ? WHERE id = ?').run(data.code, data.project, data.notes || '', exam.request_id);
    audit(db, user.id, 'alterar', 'exame', exam.id, { de: exam.starts_at, para: data.startsAt });
    return { ok: true };
  }).immediate();
}

/** Projetos já usados (sugestões ao escrever). */
export function knownProjects(db) {
  return db.prepare("SELECT project FROM requests WHERE project <> '' GROUP BY project ORDER BY MAX(created_at) DESC LIMIT 40").pluck().all();
}

/** Exames que ocupam a agenda entre duas datas, mais as horas propostas em pedidos de alteração. */
export function scheduleContext(db, fromDate, toDate) {
  const settings = {
    availability: getSetting(db, 'availability'),
    step: getSetting(db, 'slot_step_min'),
    maxPerDay: Object.fromEntries(db.prepare('SELECT id, max_per_day FROM exam_types WHERE max_per_day IS NOT NULL').all().map((t) => [t.id, t.max_per_day])),
  };
  const to = `${toDate}T23:59`;
  const from = `${fromDate}T00:00`;
  const busy = [
    ...db.prepare(`SELECT id, starts_at, ends_at, exam_type_id FROM exams
      WHERE status IN (${BUSY_STATUSES.map(() => '?').join(',')}) AND starts_at < ? AND ends_at > ?`).all(...BUSY_STATUSES, to, from),
    ...db.prepare(`SELECT id, change_starts_at AS starts_at, change_ends_at AS ends_at, exam_type_id FROM exams
      WHERE change_kind = 'mover' AND change_starts_at < ? AND change_ends_at > ?`).all(to, from),
  ];
  const blocks = db.prepare('SELECT starts_at, ends_at FROM blocks WHERE starts_at < ? AND ends_at > ?').all(to, from);
  return { ...settings, busy, blocks };
}

function checkFor(db, exam, startsAt, now) {
  const date = startsAt.slice(0, 10);
  const ctx = scheduleContext(db, date, date);
  const check = checkSlot(startsAt, exam.minutes, exam.exam_type_id, { ...ctx, now: nowLocal(now), ignoreExamId: exam.id });
  return check.ok ? { ok: true, endsAt: addMinutes(startsAt, roundUp(exam.minutes, ctx.step)) } : check;
}

const sourceOfExam = (db, exam) => db.prepare('SELECT source FROM requests WHERE id = ?').pluck().get(exam.request_id);

/** O ortoptista marca ou muda a hora de um exame. Devolve { ok } ou { ok:false, reason }. */
export function scheduleExam(db, user, examId, startsAt, now = new Date()) {
  return db.transaction(() => {
    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId);
    if (!exam) return { ok: false, reason: 'nao_existe' };
    const action = exam.status === 'por_agendar' ? 'agendar' : 'reagendar';
    const source = sourceOfExam(db, exam);
    if (source === 'investigacao') return { ok: false, reason: 'estado' };
    if (!canTransition(action, exam.status, source)) return { ok: false, reason: 'estado' };
    const slot = checkFor(db, exam, startsAt, now);
    if (!slot.ok) return slot;
    const to = action === 'agendar' ? 'agendado' : exam.status;
    // Fora do circuito, mudar a hora obriga a marcar de novo no Siima. Um pedido de alteração
    // pendente deixa de fazer sentido: o ortoptista decidiu a hora.
    const clearBooking = source === 'direto' ? ', siima_booked_at = NULL, siima_booked_by = NULL' : '';
    const res = db.prepare(`UPDATE exams SET status = ?, starts_at = ?, ends_at = ?${clearBooking},
      confirmed_at = COALESCE(confirmed_at, CASE WHEN ? = 'agendado' THEN ${NOW_SQL} END),
      change_kind = NULL, change_starts_at = NULL, change_ends_at = NULL, change_by_name = '', change_requested_at = NULL,
      updated_at = ${NOW_SQL} WHERE id = ? AND status = ?`).run(to, startsAt, slot.endsAt, to, exam.id, exam.status);
    if (res.changes !== 1) return { ok: false, reason: 'concorrencia' };
    audit(db, user.id, action, 'exame', exam.id, { de: exam.starts_at, para: startsAt });
    return { ok: true, action };
  }).immediate();
}

/** Transições simples do ortoptista (desmarcar, cancelar, realizado, faltou, anular_realizado, recusar). */
export function transitionExam(db, user, examId, action, { note = '' } = {}) {
  return db.transaction(() => {
    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId);
    if (!exam) return { ok: false, reason: 'nao_existe' };
    if (!canTransition(action, exam.status, sourceOfExam(db, exam))) return { ok: false, reason: 'estado' };
    if (action === 'anular_realizado' && exam.siima_registered_at) return { ok: false, reason: 'registado' };
    // Evita marcar por engano um exame de outro dia como feito.
    if ((action === 'realizado' || action === 'faltou') && exam.starts_at && exam.starts_at.slice(0, 10) > todayLocal()) {
      return { ok: false, reason: 'futuro' };
    }
    const to = TRANSITIONS[action].to;
    const sets = ['status = @to', `updated_at = ${NOW_SQL}`];
    if (action === 'desmarcar') sets.push('starts_at = NULL', 'ends_at = NULL', 'siima_booked_at = NULL', 'siima_booked_by = NULL');
    if (action === 'realizado') sets.push(`performed_at = ${NOW_SQL}`);
    if (action === 'anular_realizado' || action === 'faltou') sets.push('performed_at = NULL');
    if (action === 'cancelar' && exam.status === 'por_agendar') sets.push('starts_at = NULL', 'ends_at = NULL');
    if (action === 'recusar') sets.push('decision_note = @note');
    if (['cancelar', 'recusar', 'desmarcar'].includes(action)) {
      sets.push("change_kind = NULL, change_starts_at = NULL, change_ends_at = NULL, change_by_name = '', change_requested_at = NULL");
    }
    const res = db.prepare(`UPDATE exams SET ${sets.join(', ')} WHERE id = @id AND status = @from`)
      .run({ to, id: exam.id, from: exam.status, note: note.slice(0, 200) });
    if (res.changes !== 1) return { ok: false, reason: 'concorrencia' };
    audit(db, user.id, action, 'exame', exam.id, { de: exam.status, para: to, ...(note ? { motivo: note.slice(0, 200) } : {}) });
    return { ok: true };
  }).immediate();
}

/** Confirma uma reserva do secretariado. O n.º de requisição tem de existir nesse momento. */
export function confirmReservation(db, user, examId, requisition = '') {
  return db.transaction(() => {
    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId);
    if (!exam) return { ok: false, reason: 'nao_existe' };
    if (exam.status !== 'pendente') return { ok: false, reason: 'estado' };
    const req = (requisition || exam.requisition).trim().slice(0, 40);
    if (!req) return { ok: false, reason: 'sem_requisicao' };
    const res = db.prepare(`UPDATE exams SET status = 'agendado', requisition = ?, confirmed_at = ${NOW_SQL}, confirmed_by = ?,
      decision_note = '', updated_at = ${NOW_SQL} WHERE id = ? AND status = 'pendente'`).run(req, user.id, exam.id);
    if (res.changes !== 1) return { ok: false, reason: 'concorrencia' };
    audit(db, user.id, 'confirmar', 'exame', exam.id);
    return { ok: true };
  }).immediate();
}

/** Aceita ou recusa um pedido de alteração (mudar a hora ou cancelar). */
export function decideChange(db, user, examId, accept, note = '') {
  return db.transaction(() => {
    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId);
    if (!exam || !exam.change_kind) return { ok: false, reason: 'estado' };
    const clear = "change_kind = NULL, change_starts_at = NULL, change_ends_at = NULL, change_by_name = '', change_requested_at = NULL";
    let res;
    if (!accept) {
      res = db.prepare(`UPDATE exams SET ${clear}, decision_note = ?, updated_at = ${NOW_SQL} WHERE id = ? AND change_kind = ?`)
        .run(note.slice(0, 200), exam.id, exam.change_kind);
    } else if (exam.change_kind === 'cancelar') {
      res = db.prepare(`UPDATE exams SET status = 'cancelado', ${clear}, decision_note = '', updated_at = ${NOW_SQL} WHERE id = ? AND change_kind = 'cancelar'`).run(exam.id);
    } else {
      res = db.prepare(`UPDATE exams SET starts_at = change_starts_at, ends_at = change_ends_at, ${clear}, decision_note = '', updated_at = ${NOW_SQL}
        WHERE id = ? AND change_kind = 'mover'`).run(exam.id);
    }
    if (res.changes !== 1) return { ok: false, reason: 'concorrencia' };
    audit(db, user.id, accept ? 'aceitar_alteracao' : 'recusar_alteracao', 'exame', exam.id, { tipo: exam.change_kind, de: exam.starts_at, para: exam.change_starts_at });
    return { ok: true, kind: exam.change_kind };
  }).immediate();
}

/** Fora do circuito: o ortoptista confirma que marcou no Siima (ou desfaz). */
export function setSiimaBooked(db, user, examId, value) {
  return db.transaction(() => {
    const res = value
      ? db.prepare(`UPDATE exams SET siima_booked_at = ${NOW_SQL}, siima_booked_by = ?
          WHERE id = ? AND status IN ('agendado','realizado') AND siima_booked_at IS NULL
          AND request_id IN (SELECT id FROM requests WHERE source = 'direto')`).run(user.id, examId)
      : db.prepare('UPDATE exams SET siima_booked_at = NULL, siima_booked_by = NULL WHERE id = ? AND siima_booked_at IS NOT NULL').run(examId);
    if (res.changes !== 1) return { ok: false, reason: 'estado' };
    audit(db, user.id, value ? 'siima_marcado' : 'siima_marcado_desfeito', 'exame', examId);
    return { ok: true };
  }).immediate();
}

/** O ortoptista confirma que assinalou o exame como executado no Siima (ou desfaz). */
export function setSiimaRegistered(db, user, examId, value) {
  return db.transaction(() => {
    const res = value
      ? db.prepare(`UPDATE exams SET siima_registered_at = ${NOW_SQL}, siima_registered_by = ?
          WHERE id = ? AND status = 'realizado' AND siima_registered_at IS NULL
          AND request_id IN (SELECT id FROM requests WHERE source <> 'investigacao')`).run(user.id, examId)
      : db.prepare('UPDATE exams SET siima_registered_at = NULL, siima_registered_by = NULL WHERE id = ? AND siima_registered_at IS NOT NULL').run(examId);
    if (res.changes !== 1) return { ok: false, reason: 'estado' };
    audit(db, user.id, value ? 'siima_registado' : 'siima_registado_desfeito', 'exame', examId);
    return { ok: true };
  }).immediate();
}

export function setRequisition(db, actor, examId, value) {
  const v = String(value || '').trim().slice(0, 40);
  const res = db.prepare(`UPDATE exams SET requisition = ?, updated_at = ${NOW_SQL} WHERE id = ? AND status NOT IN ('cancelado','recusado')`).run(v, examId);
  if (res.changes) audit(db, actor.userId ?? null, 'requisicao', 'exame', examId, actor.name ? { por: actor.name } : null);
  return { ok: res.changes === 1 };
}

// ---------- Secretariado (link de reservas, sem conta) ----------

/** Reserva uma vaga: fica «pendente» até o ortoptista confirmar. */
export function reserve(db, { typeId, startsAt, requisition = '', name }, now = new Date()) {
  return db.transaction(() => {
    const t = db.prepare("SELECT * FROM exam_types WHERE id = ? AND active = 1 AND kind = 'clinico'").get(typeId);
    if (!t) return { ok: false, reason: 'dados_invalidos' };
    const slot = checkFor(db, { id: 0, minutes: t.minutes, exam_type_id: t.id }, startsAt, now);
    if (!slot.ok) return slot;
    const r = db.prepare("INSERT INTO requests (source, booked_by_name) VALUES ('secretariado', ?)").run(name);
    const info = db.prepare(`INSERT INTO exams (request_id, exam_type_id, status, starts_at, ends_at, minutes, is_electro, requisition)
      VALUES (?, ?, 'pendente', ?, ?, ?, ?, ?)`).run(Number(r.lastInsertRowid), t.id, startsAt, slot.endsAt, t.minutes, t.is_electro, requisition.trim().slice(0, 40));
    const id = Number(info.lastInsertRowid);
    audit(db, null, 'reservar', 'exame', id, { por: name, hora: startsAt });
    return { ok: true, id };
  }).immediate();
}

function secretariatExam(db, id) {
  return db.prepare(`SELECT e.* FROM exams e JOIN requests r ON r.id = e.request_id WHERE e.id = ? AND r.source = 'secretariado'`).get(id);
}

/**
 * Mudar a hora. Ainda por confirmar: muda logo (o ortoptista confirma a nova hora).
 * Já confirmada: fica um pedido de alteração e a hora proposta fica reservada.
 */
export function requestMove(db, examId, startsAt, name, now = new Date()) {
  return db.transaction(() => {
    const exam = secretariatExam(db, examId);
    if (!exam || !['pendente', 'agendado'].includes(exam.status) || exam.change_kind) return { ok: false, reason: 'estado' };
    if (exam.status === 'agendado' && exam.starts_at <= nowLocal(now)) return { ok: false, reason: 'estado' };
    if (startsAt === exam.starts_at) return { ok: false, reason: 'mesma_hora' };
    const slot = checkFor(db, exam, startsAt, now);
    if (!slot.ok) return slot;
    const res = exam.status === 'pendente'
      ? db.prepare(`UPDATE exams SET starts_at = ?, ends_at = ?, decision_note = '', updated_at = ${NOW_SQL} WHERE id = ? AND status = 'pendente'`).run(startsAt, slot.endsAt, exam.id)
      : db.prepare(`UPDATE exams SET change_kind = 'mover', change_starts_at = ?, change_ends_at = ?, change_by_name = ?, change_requested_at = ${NOW_SQL},
          decision_note = '', updated_at = ${NOW_SQL} WHERE id = ? AND status = 'agendado' AND change_kind IS NULL`).run(startsAt, slot.endsAt, name, exam.id);
    if (res.changes !== 1) return { ok: false, reason: 'concorrencia' };
    audit(db, null, exam.status === 'pendente' ? 'mudar_reserva' : 'pedir_alteracao', 'exame', exam.id, { por: name, de: exam.starts_at, para: startsAt });
    return { ok: true, direct: exam.status === 'pendente', from: exam.starts_at };
  }).immediate();
}

/** Cancelar. Ainda por confirmar: anula logo. Já confirmada: fica um pedido de cancelamento. */
export function requestCancel(db, examId, name, now = new Date()) {
  return db.transaction(() => {
    const exam = secretariatExam(db, examId);
    if (!exam || !['pendente', 'agendado'].includes(exam.status) || exam.change_kind) return { ok: false, reason: 'estado' };
    if (exam.status === 'agendado' && exam.starts_at <= nowLocal(now)) return { ok: false, reason: 'estado' };
    const res = exam.status === 'pendente'
      ? db.prepare(`UPDATE exams SET status = 'cancelado', updated_at = ${NOW_SQL} WHERE id = ? AND status = 'pendente'`).run(exam.id)
      : db.prepare(`UPDATE exams SET change_kind = 'cancelar', change_by_name = ?, change_requested_at = ${NOW_SQL}, decision_note = '',
          updated_at = ${NOW_SQL} WHERE id = ? AND status = 'agendado' AND change_kind IS NULL`).run(name, exam.id);
    if (res.changes !== 1) return { ok: false, reason: 'concorrencia' };
    audit(db, null, exam.status === 'pendente' ? 'anular_reserva' : 'pedir_cancelamento', 'exame', exam.id, { por: name });
    return { ok: true, direct: exam.status === 'pendente' };
  }).immediate();
}

/** Retirar um pedido de alteração ou de cancelamento ainda não decidido. */
export function withdrawChange(db, examId, name) {
  const exam = secretariatExam(db, examId);
  if (!exam || !exam.change_kind) return { ok: false, reason: 'estado' };
  const res = db.prepare(`UPDATE exams SET change_kind = NULL, change_starts_at = NULL, change_ends_at = NULL, change_by_name = '',
    change_requested_at = NULL, updated_at = ${NOW_SQL} WHERE id = ? AND change_kind IS NOT NULL`).run(exam.id);
  if (res.changes !== 1) return { ok: false, reason: 'concorrencia' };
  audit(db, null, 'retirar_pedido', 'exame', exam.id, { por: name });
  return { ok: true };
}

export function counts(db, today) {
  const one = (sql, ...p) => db.prepare(sql).pluck().get(...p);
  return {
    porConfirmar: one("SELECT COUNT(*) FROM exams WHERE status = 'pendente' OR change_kind IS NOT NULL"),
    porAgendar: one("SELECT COUNT(*) FROM exams WHERE status = 'por_agendar'"),
    porMarcarSiima: one(`SELECT COUNT(*) FROM exams e JOIN requests r ON r.id = e.request_id
      WHERE r.source = 'direto' AND e.status = 'agendado' AND e.siima_booked_at IS NULL`),
    porRegistarSiima: one(`SELECT COUNT(*) FROM exams e JOIN requests r ON r.id = e.request_id
      WHERE r.source <> 'investigacao' AND e.status = 'realizado' AND e.siima_registered_at IS NULL`),
    porRegistarAntigo: one(`SELECT MIN(e.starts_at) FROM exams e JOIN requests r ON r.id = e.request_id
      WHERE r.source <> 'investigacao' AND e.status = 'realizado' AND e.siima_registered_at IS NULL`),
    relatoriosPendentes: one(`SELECT COUNT(*) FROM exams e LEFT JOIN reports r ON r.exam_id = e.id
      WHERE e.status = 'realizado' AND (r.id IS NULL OR r.status = 'rascunho')`),
    porFechar: one("SELECT COUNT(*) FROM exams WHERE status = 'agendado' AND starts_at < ?", `${today}T00:00`),
    hoje: one("SELECT COUNT(*) FROM exams WHERE status IN ('pendente','agendado','realizado','faltou') AND starts_at >= ? AND starts_at < ?", `${today}T00:00`, `${addDays(today, 1)}T00:00`),
  };
}
