// Tarefas: quadro livre do ortoptista (colunas editáveis, ordem, projeto, prazo, lembrete).
// Nunca mexem em exames; a ligação a um exame é só uma referência.
// Há sempre uma coluna «de concluídas» (is_done): é para lá que vai o botão «Feito», e as
// tarefas dessa coluna não aparecem em «Hoje» nem enviam lembretes.
import { audit, getSetting } from './db.js';
import { notify } from './push.js';
import { nowLocal } from './time.js';

export const MIN_COLS = 2;
export const MAX_COLS = 8;

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const DONE_IDS = '(SELECT id FROM task_columns WHERE is_done = 1)';

export const tasksEnabled = (db) => getSetting(db, 'tasks_enabled') !== false;

export function listColumns(db) {
  return db.prepare('SELECT * FROM task_columns ORDER BY position, id').all();
}
export const doneColumn = (db) => db.prepare('SELECT * FROM task_columns WHERE is_done = 1 ORDER BY position LIMIT 1').get();
export const firstColumn = (db) => db.prepare('SELECT * FROM task_columns WHERE is_done = 0 ORDER BY position, id LIMIT 1').get() || doneColumn(db);
const getColumn = (db, id) => db.prepare('SELECT * FROM task_columns WHERE id = ?').get(Number(id) || 0);

// Ativas = nem arquivadas nem na lixeira.
const ACTIVE = 't.archived_at IS NULL AND t.deleted_at IS NULL';
// Definições do módulo (Tarefas → roda dentada).
export const PROGRESS_FORMATS = { fracao: '2/5', percent: '40%', ambos: '2/5 · 40%' };
export function taskSettings(db) {
  const n = (k, d, lo, hi) => { const v = Number(getSetting(db, k)); return Number.isInteger(v) && v >= lo && v <= hi ? v : d; };
  const progress = getSetting(db, 'task_progress');
  return {
    progress: PROGRESS_FORMATS[progress] ? progress : 'fracao',
    archiveDays: n('tasks_archive_days', 14, 0, 365),
    trashDays: n('tasks_trash_days', 30, 1, 365),
    inToday: getSetting(db, 'tasks_in_today') !== false,
  };
}

const SELECT = `SELECT t.*, c.name AS col_name, c.is_done AS done, e.starts_at AS exam_starts_at, et.name AS exam_type_name,
  (SELECT COUNT(*) FROM task_items i WHERE i.task_id = t.id) AS items_total,
  (SELECT COUNT(*) FROM task_items i WHERE i.task_id = t.id AND i.done = 1) AS items_done
  FROM tasks t JOIN task_columns c ON c.id = t.column_id
  LEFT JOIN exams e ON e.id = t.exam_id LEFT JOIN exam_types et ON et.id = e.exam_type_id`;

export function getTask(db, id) {
  return db.prepare(`${SELECT} WHERE t.id = ?`).get(id);
}

/** Tarefas por coluna. Na de concluídas, só as últimas `doneLimit` (as mais recentes primeiro). */
export function boardTasks(db, { project = '', doneLimit = 20 } = {}) {
  const where = project ? 'AND t.project = ?' : '';
  const args = project ? [project] : [];
  const open = db.prepare(`${SELECT} WHERE ${ACTIVE} AND c.is_done = 0 ${where} ORDER BY t.position, t.id`).all(...args);
  const done = db.prepare(`${SELECT} WHERE ${ACTIVE} AND c.is_done = 1 ${where} ORDER BY t.done_at DESC, t.id DESC LIMIT ${Number(doneLimit)}`).all(...args);
  const doneTotal = db.prepare(`SELECT COUNT(*) FROM tasks t JOIN task_columns c ON c.id = t.column_id WHERE ${ACTIVE} AND c.is_done = 1 ${where}`).pluck().get(...args);
  return { open, done, doneTotal };
}

export function tasksForExam(db, examId) {
  return db.prepare(`${SELECT} WHERE t.exam_id = ? AND t.deleted_at IS NULL ORDER BY t.archived_at IS NOT NULL, c.is_done, t.position, t.id`).all(examId);
}

export function taskProjects(db) {
  return db.prepare("SELECT project FROM tasks WHERE project <> '' AND deleted_at IS NULL GROUP BY project ORDER BY MAX(updated_at) DESC LIMIT 40").pluck().all();
}

/** Por fazer com prazo até hoje, ou com lembrete que já passou (para «Hoje» e o contador). */
export function dueTasks(db, today, now = nowLocal()) {
  return db.prepare(`${SELECT} WHERE ${ACTIVE} AND c.is_done = 0 AND ((t.due_date IS NOT NULL AND t.due_date <= ?) OR (t.remind_at IS NOT NULL AND t.remind_at <= ?))
    ORDER BY COALESCE(t.due_date, substr(t.remind_at, 1, 10)), t.position`).all(today, now);
}

export function countDue(db, today, now = nowLocal()) {
  return db.prepare(`SELECT COUNT(*) FROM tasks WHERE column_id NOT IN ${DONE_IDS} AND archived_at IS NULL AND deleted_at IS NULL
    AND ((due_date IS NOT NULL AND due_date <= ?) OR (remind_at IS NOT NULL AND remind_at <= ?))`).pluck().get(today, now);
}

function nextPosition(db, colId) {
  return db.prepare('SELECT COALESCE(MAX(position), 0) + 1 FROM tasks WHERE column_id = ? AND archived_at IS NULL AND deleted_at IS NULL').pluck().get(colId);
}

/** data: { title, notes, column_id, project, due_date, remind_at, exam_id } (já validados). */
export function createTask(db, user, data) {
  const col = getColumn(db, data.column_id) || firstColumn(db);
  const info = db.prepare(`INSERT INTO tasks (title, notes, column_id, position, project, due_date, remind_at, exam_id, created_by, done_at)
    VALUES (@title, @notes, @column_id, @position, @project, @due_date, @remind_at, @exam_id, @created_by, ${col.is_done ? NOW_SQL : 'NULL'})`)
    .run({ notes: '', project: '', due_date: null, remind_at: null, exam_id: null, ...data, column_id: col.id, position: nextPosition(db, col.id), created_by: user.id });
  const id = Number(info.lastInsertRowid);
  audit(db, user.id, 'criar', 'tarefa', id);
  return id;
}

export function updateTask(db, user, id, data) {
  return db.transaction(() => {
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!t) return { ok: false, reason: 'nao_existe' };
    const col = getColumn(db, data.column_id) || getColumn(db, t.column_id);
    // Mudar o lembrete volta a armá-lo.
    const rearm = (data.remind_at || null) !== (t.remind_at || null);
    db.prepare(`UPDATE tasks SET title = @title, notes = @notes, project = @project, due_date = @due_date, remind_at = @remind_at,
      exam_id = @exam_id, column_id = @column_id, position = @position,
      reminded_at = ${rearm ? 'NULL' : 'reminded_at'},
      done_at = CASE WHEN @is_done = 1 THEN COALESCE(done_at, ${NOW_SQL}) ELSE NULL END,
      updated_at = ${NOW_SQL} WHERE id = @id`).run({
      ...data, id, column_id: col.id, is_done: col.is_done, position: col.id === t.column_id ? t.position : nextPosition(db, col.id),
    });
    audit(db, user.id, 'alterar', 'tarefa', id);
    return { ok: true };
  })();
}

/**
 * Mover (arrastar): a tarefa vai para a coluna `colId` e a coluna fica pela ordem de
 * `orderedIds` (os ids como ficaram no ecrã). Ids que não pertencem à coluna são ignorados.
 * colId = 'feito' vai para a coluna de concluídas (botão «Feito»).
 */
export function moveTask(db, user, id, colId, orderedIds = []) {
  const col = colId === 'feito' ? doneColumn(db) : getColumn(db, colId);
  if (!col) return { ok: false, reason: 'dados_invalidos' };
  return db.transaction(() => {
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!t) return { ok: false, reason: 'nao_existe' };
    db.prepare(`UPDATE tasks SET column_id = ?, done_at = CASE WHEN ? = 1 THEN COALESCE(done_at, ${NOW_SQL}) ELSE NULL END,
      position = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(col.id, col.is_done, nextPosition(db, col.id), id);
    const inCol = new Set(db.prepare('SELECT id FROM tasks WHERE column_id = ? AND archived_at IS NULL AND deleted_at IS NULL').pluck().all(col.id));
    const order = [...new Set(orderedIds.map(Number).filter((n) => inCol.has(n)))];
    if (!order.includes(id)) order.push(id);
    const up = db.prepare('UPDATE tasks SET position = ? WHERE id = ?');
    order.forEach((tid, i) => up.run(i + 1, tid));
    // As que não vieram na lista ficam no fim, pela ordem que tinham.
    const rest = db.prepare(`SELECT id FROM tasks WHERE column_id = ? AND archived_at IS NULL AND deleted_at IS NULL AND id NOT IN (${order.map(() => '?').join(',')}) ORDER BY position`).pluck().all(col.id, ...order);
    rest.forEach((tid, i) => up.run(order.length + i + 1, tid));
    if (t.column_id !== col.id) audit(db, user.id, 'mover', 'tarefa', id, { de: t.column_id, para: col.id });
    return { ok: true, done: Boolean(col.is_done) };
  })();
}

/** Apagar = ir para a lixeira (restaurável durante 30 dias). */
export function deleteTask(db, user, id) {
  const res = db.prepare(`UPDATE tasks SET deleted_at = ${NOW_SQL} WHERE id = ? AND deleted_at IS NULL`).run(id);
  if (res.changes) audit(db, user.id, 'lixeira', 'tarefa', id);
  return { ok: res.changes === 1 };
}

export function restoreTask(db, user, id) {
  return db.transaction(() => {
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!t || (!t.deleted_at && !t.archived_at)) return { ok: false, reason: 'estado' };
    // Volta para a coluna onde estava (ou para a primeira, se a coluna já não existir), no fim.
    const col = getColumn(db, t.column_id) || firstColumn(db);
    const reopen = Boolean(t.archived_at && !t.deleted_at);
    const target = reopen && col.is_done ? firstColumn(db) : col;
    db.prepare(`UPDATE tasks SET deleted_at = NULL, archived_at = ${reopen ? 'NULL' : 'archived_at'}, column_id = ?, position = ?,
      done_at = CASE WHEN ? = 1 THEN done_at ELSE NULL END, updated_at = ${NOW_SQL} WHERE id = ?`)
      .run(target.id, nextPosition(db, target.id), target.is_done, id);
    audit(db, user.id, reopen ? 'reabrir' : 'restaurar', 'tarefa', id);
    return { ok: true, reopened: reopen };
  })();
}

export function archiveTask(db, user, id) {
  const res = db.prepare(`UPDATE tasks SET archived_at = ${NOW_SQL} WHERE id = ? AND archived_at IS NULL AND deleted_at IS NULL`).run(id);
  if (res.changes) audit(db, user.id, 'arquivar', 'tarefa', id);
  return { ok: res.changes === 1 };
}

export function purgeTask(db, user, id) {
  const res = db.prepare('DELETE FROM tasks WHERE id = ? AND deleted_at IS NOT NULL').run(id);
  if (res.changes) audit(db, user.id, 'apagar_de_vez', 'tarefa', id);
  return { ok: res.changes === 1 };
}

export function emptyTrash(db, user) {
  const n = db.prepare('DELETE FROM tasks WHERE deleted_at IS NOT NULL').run().changes;
  if (n) audit(db, user.id, 'esvaziar_lixeira', 'tarefa', null, { n });
  return n;
}

/** Arquivo: pesquisa no título, notas e itens da checklist; mais recentes primeiro. */
export function archivedTasks(db, { q = '', project = '', limit = 200 } = {}) {
  const where = ['t.archived_at IS NOT NULL', 't.deleted_at IS NULL'];
  const args = [];
  if (project) { where.push('t.project = ?'); args.push(project); }
  if (q) {
    where.push("(t.title LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM task_items i WHERE i.task_id = t.id AND i.text LIKE ? ESCAPE '\\'))");
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    args.push(like, like, like);
  }
  return db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY t.archived_at DESC LIMIT ${Number(limit)}`).all(...args);
}

export function trashedTasks(db) {
  return db.prepare(`${SELECT} WHERE t.deleted_at IS NOT NULL ORDER BY t.deleted_at DESC`).all();
}

/** Manutenção (de minuto a minuto, junto com os lembretes): arquiva concluídas antigas e esvazia a lixeira antiga. */
export function housekeeping(db, now = new Date()) {
  const { archiveDays, trashDays } = taskSettings(db);
  const archiveBefore = new Date(now.getTime() - archiveDays * 86400000).toISOString();
  const purgeBefore = new Date(now.getTime() - trashDays * 86400000).toISOString();
  // archiveDays = 0: nunca arquivar automaticamente.
  const archived = archiveDays === 0 ? 0 : db.prepare(`UPDATE tasks SET archived_at = ${NOW_SQL}
    WHERE archived_at IS NULL AND deleted_at IS NULL AND column_id IN ${DONE_IDS} AND done_at IS NOT NULL AND done_at < ?`).run(archiveBefore).changes;
  const purged = db.prepare('DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(purgeBefore).changes;
  return { archived, purged };
}

// ---------- Checklist ----------

export function listItems(db, taskId) {
  return db.prepare('SELECT * FROM task_items WHERE task_id = ? ORDER BY position, id').all(taskId);
}

export function addItem(db, taskId, text) {
  const v = String(text || '').trim().slice(0, 200);
  if (!v || !db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(taskId)) return { ok: false };
  if (db.prepare('SELECT COUNT(*) FROM task_items WHERE task_id = ?').pluck().get(taskId) >= 50) return { ok: false, reason: 'itens_limite' };
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 FROM task_items WHERE task_id = ?').pluck().get(taskId);
  const id = Number(db.prepare('INSERT INTO task_items (task_id, text, position) VALUES (?, ?, ?)').run(taskId, v, pos).lastInsertRowid);
  db.prepare(`UPDATE tasks SET updated_at = ${NOW_SQL} WHERE id = ?`).run(taskId);
  return { ok: true, id };
}

export function setItem(db, taskId, itemId, { done = null, text = null } = {}) {
  const sets = [];
  const args = [];
  if (done !== null) { sets.push('done = ?'); args.push(done ? 1 : 0); }
  if (text !== null) {
    const v = String(text).trim().slice(0, 200);
    if (!v) return { ok: false };
    sets.push('text = ?'); args.push(v);
  }
  if (!sets.length) return { ok: false };
  const res = db.prepare(`UPDATE task_items SET ${sets.join(', ')} WHERE id = ? AND task_id = ?`).run(...args, itemId, taskId);
  if (res.changes) db.prepare(`UPDATE tasks SET updated_at = ${NOW_SQL} WHERE id = ?`).run(taskId);
  return { ok: res.changes === 1 };
}

export function deleteItem(db, taskId, itemId) {
  return { ok: db.prepare('DELETE FROM task_items WHERE id = ? AND task_id = ?').run(itemId, taskId).changes === 1 };
}

// ---------- Colunas ----------

/**
 * Guarda as colunas de uma vez. cols: [{ id|null, name, remove, moveTo }] pela ordem do ecrã;
 * doneKey: índice da coluna de concluídas. Regras: 2 a 8 colunas, nomes únicos, exatamente uma
 * de concluídas, e uma coluna com tarefas só se apaga indicando para onde vão.
 */
export function saveColumns(db, user, cols, doneIndex) {
  const keep = cols.filter((c) => !c.remove);
  const names = keep.map((c) => c.name.trim());
  if (keep.length < MIN_COLS || keep.length > MAX_COLS) return { ok: false, reason: 'colunas_numero' };
  if (names.some((n) => !n || n.length > 40)) return { ok: false, reason: 'colunas_nome' };
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return { ok: false, reason: 'colunas_repetidas' };
  if (!(doneIndex >= 0 && doneIndex < cols.length) || cols[doneIndex].remove) return { ok: false, reason: 'colunas_concluidas' };
  try {
    return saveColumnsTx(db, user, cols, doneIndex, keep);
  } catch (err) {
    if (err.reason) return { ok: false, reason: err.reason };
    throw err;
  }
}

function saveColumnsTx(db, user, cols, doneIndex, keep) {
  return db.transaction(() => {
    const existing = new Map(listColumns(db).map((c) => [c.id, c]));
    // Cria as novas primeiro, para poderem receber tarefas de colunas apagadas.
    const ids = cols.map((c) => {
      if (c.id && existing.has(c.id)) return c.id;
      if (c.remove) return null;
      return Number(db.prepare("INSERT INTO task_columns (name, position, is_done) VALUES (?, 0, 0)").run(c.name.trim()).lastInsertRowid);
    });
    db.prepare('UPDATE task_columns SET is_done = 0').run();
    let pos = 0;
    cols.forEach((c, i) => {
      if (c.remove) return;
      db.prepare('UPDATE task_columns SET name = ?, position = ?, is_done = ? WHERE id = ?').run(c.name.trim(), ++pos, i === doneIndex ? 1 : 0, ids[i]);
    });
    const doneId = ids[doneIndex];
    for (const [i, c] of cols.entries()) {
      if (!c.remove || !ids[i]) continue;
      const n = db.prepare('SELECT COUNT(*) FROM tasks WHERE column_id = ?').pluck().get(ids[i]);
      if (n) {
        const targetIdx = cols.findIndex((x, j) => !x.remove && (x.id === c.moveTo || (x.id == null && `n${j}` === c.moveTo)));
        if (targetIdx < 0) throw Object.assign(new Error('destino'), { reason: 'colunas_destino' });
        const target = ids[targetIdx];
        const base = db.prepare('SELECT COALESCE(MAX(position), 0) FROM tasks WHERE column_id = ?').pluck().get(target);
        db.prepare(`UPDATE tasks SET column_id = ?, position = position + ?,
          done_at = CASE WHEN ? = ? THEN COALESCE(done_at, ${NOW_SQL}) ELSE NULL END WHERE column_id = ?`).run(target, base, target, doneId, ids[i]);
      }
      db.prepare('DELETE FROM task_columns WHERE id = ?').run(ids[i]);
    }
    // Tarefas que mudaram de lado (coluna passou a ser, ou deixou de ser, a de concluídas).
    db.prepare(`UPDATE tasks SET done_at = COALESCE(done_at, ${NOW_SQL}) WHERE column_id = ?`).run(doneId);
    db.prepare(`UPDATE tasks SET done_at = NULL WHERE column_id <> ?`).run(doneId);
    audit(db, user.id, 'colunas_tarefas', 'definicoes', null, { n: keep.length });
    return { ok: true };
  })();
}

/**
 * Lembretes vencidos: envia uma notificação a quem criou a tarefa e marca-a como lembrada.
 * Corre de minuto a minuto. Com as tarefas desligadas, não envia nada.
 * O texto da notificação é só o título (o formulário avisa para não pôr dados de doentes).
 */
export async function sendDueReminders(db, { now = nowLocal(), log = null, send } = {}) {
  if (!tasksEnabled(db)) return 0;
  const due = db.prepare(`SELECT * FROM tasks WHERE reminded_at IS NULL AND remind_at IS NOT NULL AND remind_at <= ? AND column_id NOT IN ${DONE_IDS}
    AND archived_at IS NULL AND deleted_at IS NULL`).all(now);
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
