// Acesso a dados e regras de negócio que mexem na BD. As rotas só chamam estas funções.
// Cada operação de escrita corre numa transação IMMEDIATE: duas secretárias a marcar a mesma
// vaga ao mesmo tempo nunca ficam ambas com a marcação.
import { audit, getSetting } from './db.js';
import { checkSlot, roundUp } from './domain/slots.js';
import { canTransition, TRANSITIONS } from './domain/status.js';
import { addDays, addMinutes, nowLocal, todayLocal } from './time.js';

export function listExamTypes(db, { activeOnly = true } = {}) {
  return db.prepare(`SELECT * FROM exam_types ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort, name`).all();
}

const EXAM_SELECT = `SELECT e.*, t.name AS type_name, t.code AS type_code, t.sap_code, t.report_template,
  r.patient_process, r.patient_name, r.birth_date, r.origin, r.project, r.referrer, r.priority, r.notes,
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
  return db.prepare(`SELECT r.*, u.display_name AS created_by_name FROM requests r JOIN users u ON u.id = r.created_by WHERE r.id = ?`).get(id);
}

export function createRequest(db, user, req, examTypeIds) {
  return db.transaction(() => {
    const info = db.prepare(`INSERT INTO requests (patient_process, patient_name, birth_date, origin, project, referrer, priority, notes, created_by)
      VALUES (@patient_process, @patient_name, @birth_date, @origin, @project, @referrer, @priority, @notes, @created_by)`)
      .run({ ...req, created_by: user.id });
    const requestId = Number(info.lastInsertRowid);
    const getType = db.prepare('SELECT * FROM exam_types WHERE id = ? AND active = 1');
    const ins = db.prepare('INSERT INTO exams (request_id, exam_type_id, price_cents, minutes, is_electro) VALUES (?, ?, ?, ?, ?)');
    for (const tid of examTypeIds) {
      const t = getType.get(tid);
      if (!t) throw new Error(`Tipo de exame inválido: ${tid}`);
      ins.run(requestId, t.id, t.price_cents, t.minutes, t.is_electro);
    }
    audit(db, user.id, 'criar', 'pedido', requestId, { exames: examTypeIds.length });
    return requestId;
  }).immediate();
}

export function scheduleContext(db, fromDate, toDate) {
  const settings = {
    availability: getSetting(db, 'availability'),
    step: getSetting(db, 'slot_step_min'),
    maxElectro: getSetting(db, 'max_electro_per_day'),
  };
  const busy = db.prepare(`SELECT id, starts_at, ends_at, is_electro FROM exams
    WHERE status IN ('agendado', 'realizado') AND starts_at < ? AND ends_at > ?`).all(`${toDate}T23:59`, `${fromDate}T00:00`);
  const blocks = db.prepare('SELECT starts_at, ends_at FROM blocks WHERE starts_at < ? AND ends_at > ?')
    .all(`${toDate}T23:59`, `${fromDate}T00:00`);
  return { ...settings, busy, blocks };
}

/** Marca ou remarca um exame. Devolve { ok } ou { ok:false, reason }. */
export function scheduleExam(db, user, examId, startsAt, now = new Date()) {
  return db.transaction(() => {
    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId);
    if (!exam) return { ok: false, reason: 'nao_existe' };
    const action = exam.status === 'agendado' ? 'reagendar' : 'agendar';
    if (!canTransition(action, exam.status, user.role)) return { ok: false, reason: 'estado' };
    const date = startsAt.slice(0, 10);
    const ctx = scheduleContext(db, date, date);
    const check = checkSlot(startsAt, exam.minutes, !!exam.is_electro, { ...ctx, now: nowLocal(now), ignoreExamId: exam.id });
    if (!check.ok) return check;
    const endsAt = addMinutes(startsAt, roundUp(exam.minutes, ctx.step));
    // Reagendar no Siima também tem de ser feito: limpa a confirmação de marcação.
    const res = db.prepare(`UPDATE exams SET status = 'agendado', starts_at = ?, ends_at = ?, siima_booked_at = NULL, siima_booked_by = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = ?`).run(startsAt, endsAt, exam.id, exam.status);
    if (res.changes !== 1) return { ok: false, reason: 'concorrencia' };
    audit(db, user.id, action, 'exame', exam.id, { de: exam.starts_at, para: startsAt });
    return { ok: true, action };
  }).immediate();
}

/** Transições simples (desmarcar, cancelar, realizado, faltou, anular_realizado). */
export function transitionExam(db, user, examId, action) {
  return db.transaction(() => {
    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId);
    if (!exam) return { ok: false, reason: 'nao_existe' };
    if (!canTransition(action, exam.status, user.role)) return { ok: false, reason: 'estado' };
    if (action === 'anular_realizado' && exam.siima_registered_at) return { ok: false, reason: 'registado' };
    // Evita marcar por engano um exame de outro dia como feito.
    if ((action === 'realizado' || action === 'faltou') && exam.starts_at && exam.starts_at.slice(0, 10) > todayLocal()) {
      return { ok: false, reason: 'futuro' };
    }
    const to = TRANSITIONS[action].to;
    const sets = ['status = @to', "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"];
    if (action === 'desmarcar') sets.push('starts_at = NULL', 'ends_at = NULL', 'siima_booked_at = NULL', 'siima_booked_by = NULL');
    if (action === 'realizado') sets.push("performed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    if (action === 'anular_realizado' || action === 'faltou') sets.push('performed_at = NULL');
    if (action === 'cancelar' && exam.status === 'por_agendar') sets.push('starts_at = NULL', 'ends_at = NULL');
    const res = db.prepare(`UPDATE exams SET ${sets.join(', ')} WHERE id = @id AND status = @from`)
      .run({ to, id: exam.id, from: exam.status });
    if (res.changes !== 1) return { ok: false, reason: 'concorrencia' };
    audit(db, user.id, action, 'exame', exam.id, { de: exam.status, para: to });
    return { ok: true };
  }).immediate();
}

/** Secretariado confirma que a marcação também foi feita no Siima (ou desfaz). */
export function setSiimaBooked(db, user, examId, value) {
  return db.transaction(() => {
    const res = value
      ? db.prepare(`UPDATE exams SET siima_booked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), siima_booked_by = ?
          WHERE id = ? AND status IN ('agendado','realizado') AND siima_booked_at IS NULL`).run(user.id, examId)
      : db.prepare('UPDATE exams SET siima_booked_at = NULL, siima_booked_by = NULL WHERE id = ? AND siima_booked_at IS NOT NULL').run(examId);
    if (res.changes !== 1) return { ok: false, reason: 'estado' };
    audit(db, user.id, value ? 'siima_marcado' : 'siima_marcado_desfeito', 'exame', examId);
    return { ok: true };
  }).immediate();
}

/** Ortoptista confirma que o exame realizado foi registado no Siima (ou desfaz). */
export function setSiimaRegistered(db, user, examId, value) {
  if (user.role !== 'ortoptista') return { ok: false, reason: 'estado' };
  return db.transaction(() => {
    const res = value
      ? db.prepare(`UPDATE exams SET siima_registered_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), siima_registered_by = ?
          WHERE id = ? AND status = 'realizado' AND siima_registered_at IS NULL`).run(user.id, examId)
      : db.prepare('UPDATE exams SET siima_registered_at = NULL, siima_registered_by = NULL WHERE id = ? AND siima_registered_at IS NOT NULL').run(examId);
    if (res.changes !== 1) return { ok: false, reason: 'estado' };
    audit(db, user.id, value ? 'siima_registado' : 'siima_registado_desfeito', 'exame', examId);
    return { ok: true };
  }).immediate();
}

export function counts(db, today) {
  const one = (sql, ...p) => db.prepare(sql).pluck().get(...p);
  return {
    porAgendar: one("SELECT COUNT(*) FROM exams WHERE status = 'por_agendar'"),
    porMarcarSiima: one("SELECT COUNT(*) FROM exams WHERE status = 'agendado' AND siima_booked_at IS NULL"),
    porRegistarSiima: one("SELECT COUNT(*) FROM exams WHERE status = 'realizado' AND siima_registered_at IS NULL"),
    porRegistarAntigo: one("SELECT MIN(starts_at) FROM exams WHERE status = 'realizado' AND siima_registered_at IS NULL"),
    relatoriosPendentes: one(`SELECT COUNT(*) FROM exams e LEFT JOIN reports r ON r.exam_id = e.id
      WHERE e.status = 'realizado' AND (r.id IS NULL OR r.status = 'rascunho')`),
    porFechar: one("SELECT COUNT(*) FROM exams WHERE status = 'agendado' AND starts_at < ?", `${today}T00:00`),
    hoje: one("SELECT COUNT(*) FROM exams WHERE status IN ('agendado','realizado','faltou') AND starts_at >= ? AND starts_at < ?", `${today}T00:00`, `${addDays(today, 1)}T00:00`),
  };
}
