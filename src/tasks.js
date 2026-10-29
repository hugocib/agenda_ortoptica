// Tarefas: quadro livre do ortoptista (colunas, ordem, projeto, prazo, lembrete).
// Nunca mexem em exames; a ligação a um exame é só uma referência.
import { audit, getSetting } from './db.js';
import { notify } from './push.js';
import { nowLocal } from './time.js';

export const TASK_COLS = [
  { key: 'afazer', label: 'A fazer' },
  { key: 'emcurso', label: 'Em curso' },
  { key: 'espera', label: 'À espera de alguém' },
  { key: 'feito', label: 'Feito' },
];
export const COL_KEYS = TASK_COLS.map((c) => c.key);

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export const tasksEnabled = (db) => getSetting(db, 'tasks_enabled') !== false;

const SELECT = `SELECT t.*, e.starts_at AS exam_starts_at, et.name AS exam_type_name
  FROM tasks t LEFT JOIN exams e ON e.id = t.exam_id LEFT JOIN exam_types et ON et.id = e.exam_type_id`;

export function getTask(db, id) {
  return db.prepare(`${SELECT} WHERE t.id = ?`).get(id);
}

/** Tarefas do quadro. «Feito» só as últimas `doneLimit` (as mais recentes primeiro). */
export function boardTasks(db, { project = '', doneLimit = 20 } = {}) {
  const where = project ? 'AND t.project = ?' : '';
  const args = project ? [project] : [];
  const open = db.prepare(`${SELECT} WHERE t.col <> 'feito' ${where} ORDER BY t.position, t.id`).all(...args);
  const done = db.prepare(`${SELECT} WHERE t.col = 'feito' ${where} ORDER BY t.done_at DESC, t.id DESC LIMIT ${Number(doneLimit)}`).all(...args);
  const doneTotal = db.prepare(`SELECT COUNT(*) FROM tasks t WHERE t.col = 'feito' ${where}`).pluck().get(...args);
  return { open, done, doneTotal };
}

export function tasksForExam(db, examId) {
  return db.prepare(`${SELECT} WHERE t.exam_id = ? ORDER BY t.col = 'feito', t.position, t.id`).all(examId);
}

export function taskProjects(db) {
  return db.prepare("SELECT project FROM tasks WHERE project <> '' GROUP BY project ORDER BY MAX(updated_at) DESC LIMIT 40").pluck().all();
}

/** Por fazer com prazo até hoje, ou com lembrete que já passou (para «Hoje» e o contador). */
export function dueTasks(db, today, now = nowLocal()) {
  return db.prepare(`${SELECT} WHERE t.col <> 'feito' AND ((t.due_date IS NOT NULL AND t.due_date <= ?) OR (t.remind_at IS NOT NULL AND t.remind_at <= ?))
    ORDER BY COALESCE(t.due_date, substr(t.remind_at, 1, 10)), t.position`).all(today, now);
}

function nextPosition(db, col) {
  return db.prepare('SELECT COALESCE(MAX(position), 0) + 1 FROM tasks WHERE col = ?').pluck().get(col);
}

/** data: { title, notes, col, project, due_date, remind_at, exam_id } (já validados). */
export function createTask(db, user, data) {
  const col = COL_KEYS.includes(data.col) ? data.col : 'afazer';
  const info = db.prepare(`INSERT INTO tasks (title, notes, col, position, project, due_date, remind_at, exam_id, created_by, done_at)
    VALUES (@title, @notes, @col, @position, @project, @due_date, @remind_at, @exam_id, @created_by, ${col === 'feito' ? NOW_SQL : 'NULL'})`)
    .run({ notes: '', project: '', due_date: null, remind_at: null, exam_id: null, ...data, col, position: nextPosition(db, col), created_by: user.id });
  const id = Number(info.lastInsertRowid);
  audit(db, user.id, 'criar', 'tarefa', id);
  return id;
}

export function updateTask(db, user, id, data) {
  return db.transaction(() => {
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!t) return { ok: false, reason: 'nao_existe' };
    const col = COL_KEYS.includes(data.col) ? data.col : t.col;
    // Mudar o lembrete volta a armá-lo.
    const rearm = (data.remind_at || null) !== (t.remind_at || null);
    db.prepare(`UPDATE tasks SET title = @title, notes = @notes, project = @project, due_date = @due_date, remind_at = @remind_at,
      exam_id = @exam_id, col = @col, position = @position,
      reminded_at = ${rearm ? 'NULL' : 'reminded_at'},
      done_at = CASE WHEN @col = 'feito' THEN COALESCE(done_at, ${NOW_SQL}) ELSE NULL END,
      updated_at = ${NOW_SQL} WHERE id = @id`).run({
      ...data, col, id, position: col === t.col ? t.position : nextPosition(db, col),
    });
    audit(db, user.id, 'alterar', 'tarefa', id);
    return { ok: true };
  })();
}

/**
 * Mover (arrastar): a tarefa vai para `col` e a coluna fica pela ordem de `orderedIds`
 * (os ids dessa coluna como ficaram no ecrã). Ids que não pertencem à coluna são ignorados.
 */
export function moveTask(db, user, id, col, orderedIds = []) {
  if (!COL_KEYS.includes(col)) return { ok: false, reason: 'dados_invalidos' };
  return db.transaction(() => {
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!t) return { ok: false, reason: 'nao_existe' };
    db.prepare(`UPDATE tasks SET col = ?, done_at = CASE WHEN ? = 'feito' THEN COALESCE(done_at, ${NOW_SQL}) ELSE NULL END,
      position = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(col, col, nextPosition(db, col), id);
    const inCol = new Set(db.prepare('SELECT id FROM tasks WHERE col = ?').pluck().all(col));
    const order = [...new Set(orderedIds.map(Number).filter((n) => inCol.has(n)))];
    if (!order.includes(id)) order.push(id);
    const up = db.prepare('UPDATE tasks SET position = ? WHERE id = ?');
    order.forEach((tid, i) => up.run(i + 1, tid));
    // As que não vieram na lista ficam no fim, pela ordem que tinham.
    const rest = db.prepare(`SELECT id FROM tasks WHERE col = ? AND id NOT IN (${order.map(() => '?').join(',')}) ORDER BY position`).pluck().all(col, ...order);
    rest.forEach((tid, i) => up.run(order.length + i + 1, tid));
    if (t.col !== col) audit(db, user.id, 'mover', 'tarefa', id, { de: t.col, para: col });
    return { ok: true, from: t.col };
  })();
}

export function deleteTask(db, user, id) {
  const res = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  if (res.changes) audit(db, user.id, 'apagar', 'tarefa', id);
  return { ok: res.changes === 1 };
}

/**
 * Lembretes vencidos: envia uma notificação a quem criou a tarefa e marca-a como lembrada.
 * Corre de minuto a minuto. Com as tarefas desligadas, não envia nada.
 * O texto da notificação é só o título (o formulário avisa para não pôr dados de doentes).
 */
export async function sendDueReminders(db, { now = nowLocal(), log = null, send } = {}) {
  if (!tasksEnabled(db)) return 0;
  const due = db.prepare("SELECT * FROM tasks WHERE reminded_at IS NULL AND remind_at IS NOT NULL AND remind_at <= ? AND col <> 'feito'").all(now);
  let n = 0;
  for (const t of due) {
    // Marca primeiro: um erro no envio não deve repetir o lembrete de minuto a minuto.
    db.prepare(`UPDATE tasks SET reminded_at = ${NOW_SQL} WHERE id = ? AND reminded_at IS NULL`).run(t.id);
    const body = [t.project, t.due_date ? `prazo ${t.due_date.slice(8, 10)}/${t.due_date.slice(5, 7)}` : ''].filter(Boolean).join(' · ') || 'Lembrete de tarefa';
    try {
      n += await notify(db, { title: `Lembrete: ${t.title}`, body, url: `/tarefas/${t.id}`, tag: `tarefa-${t.id}` }, { userId: t.created_by, log, ...(send ? { send } : {}) });
    } catch (err) {
      log?.warn({ msg: err?.message }, 'lembrete de tarefa falhou');
    }
  }
  return n;
}
