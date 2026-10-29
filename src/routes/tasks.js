// Quadro de tarefas (experiência): colunas livres, arrastar para mudar de coluna ou de ordem,
// projeto, prazo e lembrete por notificação. Pode desligar-se em Administração → Sistema.
import { z } from 'zod';
import { html, raw } from '../html.js';
import { getExam, knownProjects } from '../repo.js';
import {
  addItem, archivedTasks, archiveTask, boardTasks, createTask, deleteItem, deleteTask, emptyTrash, firstColumn, getTask, listColumns,
  listItems, MAX_COLS, MIN_COLS, moveTask, purgeTask, restoreTask, saveColumns, PROGRESS_FORMATS, setItem, taskProjects, taskSettings, tasksEnabled, trashedTasks, updateTask,
} from '../tasks.js';
import { addDays, fmtDate, isDate, normTime, nowLocal, toIsoDate, todayLocal } from '../time.js';
import { dateInput, ERRORS, flash, help, icon, pageHead, postButton, timeInput } from '../ui.js';
import { idParam, safeBack, send, str } from './util.js';
import { audit, setSetting } from '../db.js';
import { renderMarkdown } from '../markdown.js';

const Schema = z.object({
  title: z.string().trim().min(1, 'Escreva a tarefa.').max(200, 'Demasiado longo (máx. 200).'),
  notes: z.string().trim().max(4000, 'Notas demasiado longas.'),
  project: z.string().trim().max(120, 'Demasiado longo.'),
  column_id: z.coerce.number().int().positive(),
  due_date: z.string().refine((v) => v === '' || isDate(v), 'Data inválida (dd/mm/aaaa).'),
  remind_date: z.string().refine((v) => v === '' || isDate(v), 'Data inválida (dd/mm/aaaa).'),
  remind_time: z.string().nullable().refine((v) => v !== null, 'Hora inválida: escreva por exemplo 17:30 ou 1730.'),
}).superRefine((v, ctx) => {
  if (Boolean(v.remind_date) !== Boolean(v.remind_time)) ctx.addIssue({ code: 'custom', path: ['remind_date'], message: 'Indique o dia e a hora do lembrete (ou nenhum).' });
});

// Barra de formatação das notas: [comando, nome, texto do botão, classe].
const MD_TOOLS = [
  [['h1', 'Título 1', 'H1'], ['h2', 'Título 2', 'H2'], ['h3', 'Título 3', 'H3']],
  [['bold', 'Negrito (Ctrl+B)', 'B', 'b'], ['italic', 'Itálico (Ctrl+I)', 'I', 'i'], ['strike', 'Riscado', 'S', 's'], ['code', 'Código', '‹›']],
  [['ul', 'Lista', '•', 'dot'], ['ol', 'Lista numerada', '1.'], ['task', 'Item a marcar', '☐'], ['quote', 'Citação', '❝']],
  [['link', 'Link', 'Link'], ['hr', 'Linha separadora', '—']],
];

const ddmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function dueBadge(t, today) {
  if (!t.due_date || t.done) return t.due_date ? html`<span class="tk-due">${ddmm(t.due_date)}</span>` : '';
  const cls = t.due_date < today ? 'late' : t.due_date === today ? 'today' : '';
  const txt = t.due_date < today ? `atrasada · ${ddmm(t.due_date)}` : t.due_date === today ? 'hoje' : t.due_date === addDays(today, 1) ? 'amanhã' : ddmm(t.due_date);
  return html`<span class="tk-due ${cls}" title="Prazo">${txt}</span>`;
}

function remindBadge(t, now) {
  if (!t.remind_at || t.done) return '';
  const past = t.remind_at <= now;
  return html`<span class="tk-rem${past ? ' past' : ''}" title="${past ? 'Lembrete já enviado' : 'Lembrete'}">${icon('sino', 'ico xs')}${ddmm(t.remind_at)} ${t.remind_at.slice(11)}</span>`;
}

function examRef(t) {
  if (!t.exam_id || !t.exam_type_name) return '';
  return html`<a class="tk-exam" href="/exames/${t.exam_id}">${t.exam_type_name}${t.exam_starts_at ? ` · ${ddmm(t.exam_starts_at)}` : ''}</a>`;
}

export function progressText(done, total, format = 'fracao') {
  const pct = `${Math.round((done / total) * 100)}%`;
  return format === 'percent' ? pct : format === 'ambos' ? `${done}/${total} · ${pct}` : `${done}/${total}`;
}

export function taskCard(t, { today = todayLocal(), now = nowLocal(), back = '/tarefas', draggable = true, progress = 'fracao' } = {}) {
  return html`<li class="tk-card${t.done ? ' done' : ''}" data-task="${t.id}"${draggable ? raw(' draggable="true"') : ''}>
    <a class="tk-title" href="/tarefas/${t.id}">${t.title}</a>
    <div class="tk-meta">${t.project ? html`<span class="tk-proj">${t.project}</span>` : ''}${dueBadge(t, today)}${remindBadge(t, now)}${examRef(t)}${t.items_total ? html`<span class="tk-check${t.items_done === t.items_total ? ' all' : ''}" title="Checklist: ${t.items_done} de ${t.items_total}">${icon('certo', 'ico xs')}${progressText(t.items_done, t.items_total, progress)}</span>` : ''}${t.notes ? html`<span class="tk-notes" title="Tem notas">notas</span>` : ''}</div>
    ${t.archived_at || t.deleted_at ? '' : html`<div class="tk-acts">${!t.done
      ? postButton(`/tarefas/${t.id}/mover`, 'Feito', { kind: 'mini', back, name: 'col', value: 'feito' })
      : postButton(`/tarefas/${t.id}/arquivar`, 'Arquivar', { kind: 'mini ghost', back })}</div>`}
  </li>`;
}

function form(req, db, { task = null, values = {}, errors = {}, exam = null }) {
  const v = { column_id: firstColumn(db).id, ...values };
  const cols = listColumns(db);
  const err = (k) => (errors[k] ? html`<span class="field-err">${errors[k]}</span>` : '');
  const inv = (k) => (errors[k] ? raw(' aria-invalid="true"') : '');
  const projects = [...new Set([...taskProjects(db), ...knownProjects(db)])];
  const today = todayLocal();
  const title = task ? 'Tarefa' : 'Nova tarefa';
  const ck = task ? checklistParts(db, task) : null;
  const linked = exam || (task?.exam_id ? { id: task.exam_id, type_name: task.exam_type_name, starts_at: task.exam_starts_at } : null);
  return {
    title,
    active: 'tarefas',
    body: html`${pageHead(title, { back: { href: '/tarefas', label: 'Tarefas' } })}
      ${flash(req.query, req)}
      ${task?.deleted_at ? html`<div class="notice warn"><p>Esta tarefa está na lixeira e é apagada de vez ${taskSettings(db).trashDays} dias depois de lá ter ido.</p>${postButton(`/tarefas/${task.id}/restaurar`, 'Restaurar', { kind: 'primary' })}</div>`
        : task?.archived_at ? html`<div class="notice warn"><p>Esta tarefa está no arquivo (fora do quadro).</p>${postButton(`/tarefas/${task.id}/restaurar`, 'Reabrir no quadro', { kind: 'primary' })}</div>` : ''}
      ${Object.keys(errors).length ? html`<div class="notice err" role="alert">Corrija os campos assinalados.</div>` : ''}
      <form method="post" action="${task ? `/tarefas/${task.id}` : '/tarefas'}" class="sheet form-grid guarded" novalidate>
        <label class="span2">Tarefa *<input name="title" required maxlength="200" value="${v.title || ''}"${task ? '' : raw(' autofocus')}${inv('title')}>
          <span class="fhint">Aparece nas notificações: não escreva dados de doentes. Para um exame, use a ligação abaixo.</span>${err('title')}</label>
        <label>Projeto <span class="opt">opcional</span><input name="project" maxlength="120" value="${v.project || ''}" list="tk-projetos" autocomplete="off"${inv('project')}>${err('project')}</label>
        <datalist id="tk-projetos">${projects.map((p) => html`<option value="${p}">`)}</datalist>
        <label>Coluna<select name="column_id">${cols.map((c) => html`<option value="${c.id}"${Number(v.column_id) === c.id ? raw(' selected') : ''}>${c.name}</option>`)}</select></label>
        <label>Prazo <span class="opt">opcional</span>${dateInput('due_date', v.due_date || '', { invalid: Boolean(errors.due_date) })}${err('due_date')}</label>
        <fieldset class="tk-remind">
          <legend>Lembrete <span class="opt">opcional</span></legend>
          <span class="fhint">Chega como notificação aos dispositivos onde as ativou, e a tarefa aparece em «Hoje».</span>
          <div class="toolbar">
            <label><span class="sr">Dia do lembrete</span>${dateInput('remind_date', v.remind_date || '', { invalid: Boolean(errors.remind_date), label: 'Dia do lembrete' })}</label>
            <label><span class="sr">Hora do lembrete</span>${timeInput('remind_time', v.remind_time || '', { label: 'Hora do lembrete (hh:mm)', invalid: Boolean(errors.remind_time) })}</label>
          </div>
          <div class="chips" data-remind-presets>
            <button type="button" class="btn mini ghost" data-remind="${today}T17:00">Hoje 17:00</button>
            <button type="button" class="btn mini ghost" data-remind="${addDays(today, 1)}T09:00">Amanhã 09:00</button>
            <button type="button" class="btn mini ghost" data-remind="due">No prazo, 09:00</button>
            <button type="button" class="btn mini ghost" data-remind="">Sem lembrete</button>
          </div>
          ${err('remind_date')}${err('remind_time')}
          ${task?.reminded_at ? html`<p class="fhint">Lembrete já enviado. Mudar o dia ou a hora volta a ativá-lo.</p>` : ''}
        </fieldset>
        ${linked ? html`<div class="span2 tk-link"><input type="hidden" name="exam_id" value="${linked.id}">
          <span>Ligada ao exame <a href="/exames/${linked.id}">${linked.type_name || `n.º ${linked.id}`}${linked.starts_at ? ` · ${fmtDate(linked.starts_at)} ${linked.starts_at.slice(11)}` : ''}</a></span>
          <label class="check"><input type="checkbox" name="unlink" value="1"> <span>Desligar do exame</span></label></div>` : ''}
        <div class="span2 tk-notes-box" data-notes>
          ${task && v.notes ? html`<div class="tk-notes-h"><span class="tk-notes-l">Notas</span><button type="button" class="btn mini ghost" data-notes-edit hidden>Editar notas</button></div>
            <div class="md tk-notes-view" data-notes-view>${raw(renderMarkdown(v.notes))}</div>` : ''}
          <div class="tk-notes-edit" data-notes-field>
            <label for="tk-notes">Notas <span class="opt">opcional · Markdown: <code>#</code> títulos, <code>**negrito**</code>, <code>*itálico*</code>, <code>- lista</code>, <code>- [ ] item</code>, <code>[texto](https://…)</code></span></label>
            <div class="md-bar" role="toolbar" aria-label="Formatação das notas" aria-controls="tk-notes" data-md-bar hidden>
              ${MD_TOOLS.map((g) => html`<span class="md-group">${g.map(([cmd, label, text, cls]) => html`<button type="button" class="md-btn${cls ? ` ${cls}` : ''}" data-md="${cmd}" aria-label="${label}" title="${label}">${text}</button>`)}</span>`)}
            </div>
            <textarea id="tk-notes" name="notes" rows="${v.notes && v.notes.split('\n').length > 6 ? 12 : 5}" maxlength="4000">${v.notes || ''}</textarea>${err('notes')}
          </div>
        </div>
        ${ck ? ck.body : html`<p class="span2 fhint">A checklist acrescenta-se depois de criar a tarefa.</p>`}
        <div class="span2 form-actions"><button class="btn primary" type="submit">${task ? 'Guardar' : 'Criar tarefa'}</button><a class="btn ghost" href="${linked && !task ? `/exames/${linked.id}` : '/tarefas'}">Cancelar</a></div>
      </form>
      ${ck ? ck.forms : ''}
      ${task ? html`<div class="more-actions">
        ${task.done && !task.archived_at ? postButton(`/tarefas/${task.id}/arquivar`, 'Arquivar', { back: `/tarefas/${task.id}` }) : ''}
        ${postButton(`/tarefas/${task.id}/apagar`, 'Pôr na lixeira', { kind: 'danger' })}</div>` : ''}`,
  };
}

function parse(db, body) {
  const values = Object.fromEntries(['title', 'notes', 'project', 'column_id', 'due_date', 'remind_date', 'remind_time'].map((k) => [k, str(body?.[k])]));
  values.due_date = toIsoDate(values.due_date);
  values.remind_date = toIsoDate(values.remind_date);
  if (!values.column_id) values.column_id = String(firstColumn(db).id);
  const rawTime = values.remind_time;
  const parsed = Schema.safeParse({ ...values, remind_time: normTime(values.remind_time) });
  const t = normTime(rawTime);
  if (t) values.remind_time = t;
  const errors = {};
  if (!parsed.success) for (const i of parsed.error.issues) errors[i.path[0]] ??= i.message;
  const examId = Number(str(body?.exam_id)) || null;
  const exam = examId && str(body?.unlink) !== '1' ? db.prepare('SELECT id FROM exams WHERE id = ?').get(examId) : null;
  if (!parsed.success) return { values, errors };
  const d = parsed.data;
  return {
    values,
    errors,
    data: {
      title: d.title, notes: d.notes, project: d.project, column_id: d.column_id,
      due_date: d.due_date || null, remind_at: d.remind_date ? `${d.remind_date}T${d.remind_time}` : null, exam_id: exam ? exam.id : null,
    },
  };
}

export default async function taskRoutes(app, { db }) {
  // Desligado: as páginas deixam de existir (os dados ficam guardados).
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/tarefas') && !tasksEnabled(db)) return reply.callNotFound();
  });

  app.get('/tarefas', async (req, reply) => {
    const project = str(req.query.projeto).slice(0, 120);
    const { open, done, doneTotal } = boardTasks(db, { project });
    const today = todayLocal();
    const now = nowLocal();
    const projects = taskProjects(db);
    const back = project ? `/tarefas?projeto=${encodeURIComponent(project)}` : '/tarefas';
    const cols = listColumns(db);
    const first = firstColumn(db);
    const trashN = db.prepare('SELECT COUNT(*) FROM tasks WHERE deleted_at IS NOT NULL').pluck().get();
    const conf = taskSettings(db);
    const byCol = Object.fromEntries(cols.map((c) => [c.id, c.is_done ? done : open.filter((t) => t.column_id === c.id)]));
    const late = open.filter((t) => t.due_date && t.due_date < today).length;
    return send(reply, req, {
      title: 'Tarefas',
      active: 'tarefas',
      wide: true,
      body: html`${pageHead('Tarefas', {
          sub: html`<span>${open.length} por fazer${late ? html` · <span class="late-txt">${late} ${late === 1 ? 'atrasada' : 'atrasadas'}</span>` : ''}</span>`,
          info: html`<p>Quadro livre para o seu trabalho: protocolos, pedidos a pessoas, o que tiver de fazer sobre um exame. As tarefas nunca mudam exames nem a agenda.</p><p><b>Arraste</b> para mudar de coluna ou de ordem. Com prazo ou lembrete, aparecem em «Hoje» e o lembrete chega como notificação (ative-as em A minha conta).</p><p>É uma experiência: pode desligar o quadro em Administração → Sistema, sem perder as tarefas.</p>`,
          actions: html`<a class="btn ghost" href="/tarefas/arquivo">Arquivo</a><a class="btn ghost" href="/tarefas/lixeira">Lixeira${trashN ? html` <span class="count">${trashN}</span>` : ''}</a><a class="btn icon-only" href="/tarefas/definicoes" aria-label="Definições das tarefas" title="Definições das tarefas">${icon('definicoes')}</a><a class="btn primary" href="/tarefas/nova${project ? `?projeto=${encodeURIComponent(project)}` : ''}">Nova tarefa</a>`,
        })}
        ${flash(req.query, req)}
        ${projects.length ? html`<nav class="chips tk-filter" aria-label="Filtrar por projeto"><a class="chip${project ? '' : ' active'}" href="/tarefas"${project ? '' : raw(' aria-current="page"')}>Todas</a>${projects.map((p) => html`<a class="chip${p === project ? ' active' : ''}" href="/tarefas?projeto=${encodeURIComponent(p)}"${p === project ? raw(' aria-current="page"') : ''}>${p}</a>`)}</nav>` : ''}
        <div class="tk-board" data-tasks data-back="${back}">
          ${cols.map((c) => html`<section class="tk-col${c.is_done ? ' is-done' : ''}" data-col="${c.id}" aria-labelledby="tk-h-${c.id}">
            <h2 class="tk-col-h" id="tk-h-${c.id}">${c.name}<span class="count">${c.is_done ? doneTotal : byCol[c.id].length}</span></h2>
            ${c.id === first.id ? html`<form method="post" action="/tarefas" class="tk-quick">
              <input type="hidden" name="column_id" value="${c.id}"><input type="hidden" name="project" value="${project}"><input type="hidden" name="back" value="${back}">
              <label class="sr" for="tk-q">Nova tarefa</label><input id="tk-q" name="title" maxlength="200" required placeholder="+ Nova tarefa">
              <button class="btn mini" type="submit">Adicionar</button></form>` : ''}
            <ul class="tk-cards" data-drop="${c.id}"${c.is_done ? raw(' data-done') : ''}>${byCol[c.id].map((t) => taskCard(t, { today, now, back, progress: conf.progress }))}</ul>
            ${!byCol[c.id].length ? html`<p class="tk-none">${c.is_done ? 'Nada feito ainda.' : '—'}</p>` : ''}
            ${c.is_done && doneTotal > done.length ? html`<p class="muted small">Mostram-se as ${done.length} mais recentes de ${doneTotal}.</p>` : ''}
            ${c.is_done && conf.archiveDays ? html`<p class="muted small tk-arch-note">Vão para o <a href="/tarefas/arquivo">arquivo</a> ${conf.archiveDays} ${conf.archiveDays === 1 ? 'dia' : 'dias'} depois de feitas.</p>` : ''}
          </section>`)}
        </div>`,
    });
  });

  // Colunas: nome, ordem, quantas, e qual é a das concluídas.
  const colsPage = (req, cols, error = '') => {
    const rows = [...cols, { id: null, name: '', is_done: 0, n: 0, isNew: true }];
    const doneIdx = rows.findIndex((c) => c.is_done);
    const conf = taskSettings(db);
    return {
      title: 'Definições das tarefas',
      active: 'tarefas',
      body: html`${pageHead('Definições das tarefas', { back: { href: '/tarefas', label: 'Tarefas' } })}
        ${flash(req.query, req)}
        ${error ? html`<div class="notice err" role="alert">${error}</div>` : ''}
        <section class="sec" id="apresentacao"><div class="sec-h"><h2>Apresentação, arquivo e lixeira</h2></div>
          <form method="post" action="/tarefas/definicoes" class="sheet form-grid">
            <fieldset><legend>Progresso da checklist nos cartões</legend>
              <div class="seg" role="radiogroup" aria-label="Progresso da checklist">${Object.entries(PROGRESS_FORMATS).map(([k, l]) => html`<label><input type="radio" name="task_progress" value="${k}"${conf.progress === k ? raw(' checked') : ''}> ${l}</label>`)}</div>
            </fieldset>
            <fieldset><legend>«Hoje»</legend>
              <label class="check"><input type="checkbox" name="tasks_in_today" value="1"${conf.inToday ? raw(' checked') : ''}> <span>Mostrar em «Hoje» as tarefas com prazo até hoje ou lembrete já passado</span></label>
            </fieldset>
            <label>Arquivar concluídas ao fim de <span class="opt">dias; 0 = só à mão</span><input name="tasks_archive_days" type="number" inputmode="numeric" min="0" max="365" value="${conf.archiveDays}" class="num small-num"></label>
            <label>Apagar de vez da lixeira ao fim de <span class="opt">dias</span><input name="tasks_trash_days" type="number" inputmode="numeric" min="1" max="365" value="${conf.trashDays}" class="num small-num"></label>
            <div class="span2 form-actions"><button class="btn primary" type="submit">Guardar</button></div>
          </form>
        </section>
        <section class="sec" id="colunas"><div class="sec-h"><h2>Colunas</h2>${help(html`<p>Mude o nome, a ordem (setas) e o número de colunas (${MIN_COLS} a ${MAX_COLS}).</p><p>A coluna <b>de concluídas</b> é para onde vai o botão «Feito»; as tarefas lá não aparecem em «Hoje» nem enviam lembretes.</p><p>Para apagar uma coluna com tarefas, escolha para onde passam.</p>`)}</div>
        <form method="post" action="/tarefas/colunas" class="sheet stack guarded" data-cols>
          <table class="tk-cols-t">
            <thead><tr><th scope="col">Ordem</th><th scope="col">Nome</th><th scope="col">Concluídas ${help('Só uma: a coluna onde ficam as tarefas feitas.')}</th><th scope="col">Tarefas</th><th scope="col">Apagar</th></tr></thead>
            <tbody>${rows.map((c, i) => html`<tr data-col-row${c.isNew ? raw(' class="new"') : ''}>
              <td class="tk-ord"><input type="hidden" name="id" value="${c.id || ''}">
                <button type="button" class="btn mini ghost" data-col-up aria-label="Subir ${c.name || 'nova coluna'}">↑</button><button type="button" class="btn mini ghost" data-col-down aria-label="Descer ${c.name || 'nova coluna'}">↓</button></td>
              <td><input name="name" maxlength="40" value="${c.name}" placeholder="${c.isNew ? '+ Nova coluna (opcional)' : ''}" aria-label="Nome da coluna"></td>
              <td class="center"><input type="radio" name="done" value="${c.id || 'nova'}"${i === doneIdx ? raw(' checked') : ''} aria-label="${c.name || 'Nova coluna'} é a das concluídas"></td>
              <td class="center">${c.isNew ? '' : c.n}</td>
              <td>${c.isNew ? '' : html`<select name="remove" aria-label="Apagar ${c.name}"><option value="">não</option>${c.n
                ? rows.filter((o) => !o.isNew && o.id !== c.id).map((o) => html`<option value="${o.id}">sim, tarefas para «${o.name}»</option>`)
                : html`<option value="x">sim</option>`}</select>`}</td>
            </tr>`)}</tbody>
          </table>
          <p class="muted small">Pode acrescentar uma coluna de cada vez na última linha. As setas mudam a ordem sem guardar; carregue em «Guardar» no fim.</p>
          <div class="form-actions"><button class="btn primary" type="submit">Guardar colunas</button></div>
        </form></section>
        <section class="sec quiet" id="quadro"><div class="sec-h"><h2>Quadro de tarefas</h2></div>
          <p>O quadro está ligado. Desligado, o menu «Tarefas» desaparece e não são enviados lembretes; as tarefas ficam guardadas. Volta a ligar-se em Administração → Sistema.</p>
          <form method="post" action="/admin/tarefas" class="inline"><button class="btn" name="on" value="0" data-confirm="Desligar o quadro de tarefas? As tarefas ficam guardadas.">Desligar o quadro</button></form>
        </section>`,
    };
  };

  const withCounts = () => listColumns(db).map((c) => ({ ...c, n: db.prepare('SELECT COUNT(*) FROM tasks WHERE column_id = ?').pluck().get(c.id) }));

  app.get('/tarefas/definicoes', async (req, reply) => send(reply, req, colsPage(req, withCounts())));
  app.get('/tarefas/colunas', async (req, reply) => reply.redirect('/tarefas/definicoes#colunas'));
  app.post('/tarefas/definicoes', async (req, reply) => {
    const b = req.body || {};
    const int = (v, lo, hi) => { const n = Number.parseInt(str(v), 10); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
    const archive = int(b.tasks_archive_days, 0, 365);
    const trash = int(b.tasks_trash_days, 1, 365);
    const progress = str(b.task_progress);
    if (archive === null || trash === null || !PROGRESS_FORMATS[progress]) return reply.redirect('/tarefas/definicoes?err=dados_invalidos');
    db.transaction(() => {
      setSetting(db, 'task_progress', progress);
      setSetting(db, 'tasks_archive_days', archive);
      setSetting(db, 'tasks_trash_days', trash);
      setSetting(db, 'tasks_in_today', str(b.tasks_in_today) === '1');
      audit(db, req.user.id, 'definicoes_tarefas', 'definicoes');
    })();
    return reply.redirect('/tarefas/definicoes?msg=guardado');
  });

  app.post('/tarefas/colunas', async (req, reply) => {
    const arr = (v) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((x) => String(x));
    const ids = arr(req.body?.id);
    const names = arr(req.body?.name);
    const removes = arr(req.body?.remove);
    const doneKey = str(req.body?.done);
    // A linha nova (sem id) só conta se tiver nome. As linhas existentes trazem «remove».
    let r = 0;
    const cols = ids.map((id, i) => {
      const isNew = !id;
      const rem = isNew ? '' : removes[r++] || '';
      return { id: isNew ? null : Number(id), name: names[i] || '', remove: isNew ? !names[i]?.trim() : Boolean(rem), moveTo: rem && rem !== 'x' ? Number(rem) : null };
    });
    const doneIdx = cols.findIndex((c) => (c.id ? String(c.id) === doneKey : doneKey === 'nova'));
    const res = saveColumns(db, req.user, cols, doneIdx);
    if (!res.ok) {
      return send(reply, req, colsPage(req, withCounts(), ERRORS[res.reason]), 400);
    }
    return reply.redirect('/tarefas/definicoes?msg=colunas#colunas');
  });

  app.get('/tarefas/nova', async (req, reply) => {
    const examId = Number(str(req.query.exame)) || null;
    const e = examId ? getExam(db, examId) : null;
    return send(reply, req, form(req, db, {
      exam: e ? { id: e.id, type_name: e.type_name, starts_at: e.starts_at } : null,
      values: { project: str(req.query.projeto).slice(0, 120) || (e?.project || '') },
    }));
  });

  app.post('/tarefas', async (req, reply) => {
    const { values, errors, data } = parse(db, req.body);
    const back = safeBack(req.body?.back, '');
    if (!data) {
      if (back) return reply.redirect(`${back.split('#')[0]}${back.includes('?') ? '&' : '?'}err=dados_invalidos`);
      return send(reply, req, form(req, db, { values, errors }), 400);
    }
    const id = createTask(db, req.user, data);
    if (back) return reply.redirect(`${back}${back.includes('?') ? '&' : '?'}msg=tarefa`);
    return reply.redirect(data.exam_id ? `/exames/${data.exam_id}?msg=tarefa` : `/tarefas?msg=tarefa#t-${id}`);
  });

  app.get('/tarefas/:id', async (req, reply) => {
    const id = idParam(req);
    const t = id && getTask(db, id);
    if (!t) return reply.callNotFound();
    return send(reply, req, form(req, db, {
      task: t,
      values: { ...t, remind_date: t.remind_at?.slice(0, 10) || '', remind_time: t.remind_at?.slice(11) || '' },
    }));
  });

  app.post('/tarefas/:id', async (req, reply) => {
    const id = idParam(req);
    const t = id && getTask(db, id);
    if (!t) return reply.callNotFound();
    const { values, errors, data } = parse(db, req.body);
    if (!data) return send(reply, req, form(req, db, { task: t, values, errors }), 400);
    updateTask(db, req.user, id, data);
    return reply.redirect(`/tarefas/${id}?msg=tarefa_guardada`);
  });

  // Arrastar (com JS: responde JSON) ou botão «Feito» (sem JS: volta ao sítio de onde veio).
  app.post('/tarefas/:id/mover', async (req, reply) => {
    const id = idParam(req);
    if (!id) return reply.callNotFound();
    const col = str(req.body?.col);
    const ids = str(req.body?.ids).split(',').map(Number).filter((n) => Number.isSafeInteger(n) && n > 0).slice(0, 500);
    const res = moveTask(db, req.user, id, col, ids);
    if (str(req.body?.ajax) === '1') return reply.code(res.ok ? 200 : 400).send({ ok: res.ok });
    const back = safeBack(req.body?.back, '/tarefas');
    return reply.redirect(`${back.split('#')[0]}${back.includes('?') ? '&' : '?'}${res.ok ? `msg=${res.done ? 'tarefa_feita' : 'tarefa_guardada'}` : 'err=dados_invalidos'}`);
  });

  app.post('/tarefas/:id/apagar', async (req, reply) => {
    const id = idParam(req);
    if (!id) return reply.callNotFound();
    deleteTask(db, req.user, id);
    return reply.redirect(`/tarefas?msg=tarefa_lixeira&u=${id}`);
  });

  app.post('/tarefas/:id/arquivar', async (req, reply) => {
    const id = idParam(req);
    if (!id) return reply.callNotFound();
    const res = archiveTask(db, req.user, id);
    const back = safeBack(req.body?.back, '/tarefas');
    return reply.redirect(`${back.split('#')[0]}${back.includes('?') ? '&' : '?'}${res.ok ? 'msg=tarefa_arquivada' : 'err=estado'}`);
  });

  app.post('/tarefas/:id/restaurar', async (req, reply) => {
    const id = idParam(req);
    if (!id) return reply.callNotFound();
    const res = restoreTask(db, req.user, id);
    return reply.redirect(res.ok ? `/tarefas/${id}?msg=${res.reopened ? 'tarefa_reaberta' : 'tarefa_restaurada'}` : `/tarefas/${id}?err=estado`);
  });

  app.post('/tarefas/:id/apagar-de-vez', async (req, reply) => {
    const id = idParam(req);
    if (!id) return reply.callNotFound();
    purgeTask(db, req.user, id);
    return reply.redirect('/tarefas/lixeira?msg=tarefa_apagada');
  });

  // ---------- Arquivo e lixeira ----------
  app.get('/tarefas/arquivo', async (req, reply) => {
    const q = str(req.query.q).trim().slice(0, 80);
    const project = str(req.query.projeto).slice(0, 120);
    const rows = archivedTasks(db, { q, project });
    const projects = taskProjects(db);
    return send(reply, req, {
      title: 'Arquivo de tarefas',
      active: 'tarefas',
      body: html`${pageHead('Arquivo', { back: { href: '/tarefas', label: 'Tarefas' }, info: `Tarefas fora do quadro. ${taskSettings(db).archiveDays ? `As concluídas vêm para aqui sozinhas ${taskSettings(db).archiveDays} dias depois de feitas; também` : 'Pode'} arquivar à mão. «Reabrir» volta a pô-la no quadro.` })}
        ${flash(req.query, req)}
        <form method="get" action="/tarefas/arquivo" class="toolbar" role="search">
          <label><span class="sr">Pesquisar</span><input type="search" name="q" value="${q}" placeholder="Pesquisar no título, notas e checklist"></label>
          ${projects.length ? html`<label><span class="sr">Projeto</span><select name="projeto"><option value="">Todos os projetos</option>${projects.map((p) => html`<option${p === project ? raw(' selected') : ''}>${p}</option>`)}</select></label>` : ''}
          <button class="btn" type="submit">Pesquisar</button>
          ${q || project ? html`<a href="/tarefas/arquivo">limpar</a>` : ''}
        </form>
        ${rows.length ? html`<ul class="list tk-list">${rows.map((t) => html`<li class="tk-row">
            <div><a class="tk-title" href="/tarefas/${t.id}">${t.title}</a>
              <div class="tk-meta">${t.project ? html`<span class="tk-proj">${t.project}</span>` : ''}<span>${t.done_at ? `feita a ${fmtDate(t.done_at.slice(0, 10))}` : `arquivada a ${fmtDate(t.archived_at.slice(0, 10))}`}</span>${t.items_total ? html`<span class="tk-check">${icon('certo', 'ico xs')}${t.items_done}/${t.items_total}</span>` : ''}${examRef(t)}</div></div>
            <div class="tk-row-a">${postButton(`/tarefas/${t.id}/restaurar`, 'Reabrir', { kind: 'mini' })}${postButton(`/tarefas/${t.id}/apagar`, 'Lixeira', { kind: 'mini ghost' })}</div>
          </li>`)}</ul>`
          : html`<p class="empty">${q || project ? 'Nada encontrado no arquivo.' : 'O arquivo está vazio.'}</p>`}`,
    });
  });

  app.get('/tarefas/lixeira', async (req, reply) => {
    const rows = trashedTasks(db);
    const trashDays = taskSettings(db).trashDays;
    const left = (t) => Math.max(0, trashDays - Math.floor((Date.now() - Date.parse(t.deleted_at)) / 86400000));
    return send(reply, req, {
      title: 'Lixeira de tarefas',
      active: 'tarefas',
      body: html`${pageHead('Lixeira', { back: { href: '/tarefas', label: 'Tarefas' }, info: `As tarefas apagadas ficam aqui ${trashDays} dias e depois são apagadas de vez.`,
          actions: rows.length ? postButton('/tarefas/lixeira/esvaziar', 'Esvaziar lixeira', { kind: 'danger', confirm: `Apagar de vez ${rows.length} ${rows.length === 1 ? 'tarefa' : 'tarefas'}? Não dá para desfazer.` }) : '' })}
        ${flash(req.query, req)}
        ${rows.length ? html`<ul class="list tk-list">${rows.map((t) => html`<li class="tk-row">
            <div><span class="tk-title">${t.title}</span>
              <div class="tk-meta">${t.project ? html`<span class="tk-proj">${t.project}</span>` : ''}<span>apagada de vez daqui a ${left(t)} ${left(t) === 1 ? 'dia' : 'dias'}</span></div></div>
            <div class="tk-row-a">${postButton(`/tarefas/${t.id}/restaurar`, 'Restaurar', { kind: 'mini' })}${postButton(`/tarefas/${t.id}/apagar-de-vez`, 'Apagar de vez', { kind: 'mini danger', confirm: 'Apagar de vez esta tarefa? Não dá para desfazer.' })}</div>
          </li>`)}</ul>` : html`<p class="empty clear">A lixeira está vazia.</p>`}`,
    });
  });

  app.post('/tarefas/lixeira/esvaziar', async (req, reply) => {
    emptyTrash(db, req.user);
    return reply.redirect('/tarefas/lixeira?msg=lixeira_vazia');
  });

  // ---------- Checklist ----------
  const itemBack = (id) => `/tarefas/${id}#checklist`;
  app.post('/tarefas/:id/itens', async (req, reply) => {
    const id = idParam(req);
    if (!id) return reply.callNotFound();
    const res = addItem(db, id, str(req.body?.text));
    if (str(req.body?.ajax) === '1') return reply.code(res.ok ? 200 : 400).send({ ok: res.ok, id: res.id, reason: res.reason });
    return reply.redirect(res.ok ? itemBack(id) : `/tarefas/${id}?err=${res.reason || 'dados_invalidos'}#checklist`);
  });
  app.post('/tarefas/:id/itens/:item', async (req, reply) => {
    const id = idParam(req);
    const item = Number.parseInt(req.params.item, 10);
    if (!id || !item) return reply.callNotFound();
    const done = req.body?.done === undefined ? null : str(req.body.done) === '1';
    const text = req.body?.text === undefined ? null : str(req.body.text);
    const res = setItem(db, id, item, { done, text });
    if (str(req.body?.ajax) === '1') return reply.code(res.ok ? 200 : 400).send({ ok: res.ok });
    return reply.redirect(itemBack(id));
  });
  app.post('/tarefas/:id/itens/:item/apagar', async (req, reply) => {
    const id = idParam(req);
    const item = Number.parseInt(req.params.item, 10);
    if (!id || !item) return reply.callNotFound();
    const res = deleteItem(db, id, item);
    if (str(req.body?.ajax) === '1') return reply.code(res.ok ? 200 : 400).send({ ok: res.ok });
    return reply.redirect(itemBack(id));
  });
}

/**
 * Checklist da tarefa, mostrada dentro do cartão (do formulário da tarefa). Os botões e o campo
 * pertencem a formulários próprios, fora do cartão (atributo form=), porque não pode haver
 * formulários dentro de formulários. Com JS, marcar, acrescentar e apagar não recarregam a página
 * (para não se perder o que ainda não foi guardado na tarefa).
 */
export function checklistParts(db, task) {
  const items = listItems(db, task.id);
  const done = items.filter((i) => i.done).length;
  const base = `/tarefas/${task.id}/itens`;
  const fmt = taskSettings(db).progress;
  const body = html`<div class="span2 tk-checklist" id="checklist" data-checklist="${task.id}">
    <div class="tk-check-h"><span class="tk-check-l" id="h-check">Checklist</span><span class="count" data-check-count data-format="${fmt}">${items.length ? progressText(done, items.length, fmt) : '0'}</span></div>
    <div class="tk-progress" aria-hidden="true"${items.length ? '' : raw(' hidden')}><span data-check-bar class="w${items.length ? Math.round((done / items.length) * 20) * 5 : 0}"></span></div>
    <ul class="tk-items" aria-labelledby="h-check">${items.map((i) => itemRow(task.id, i))}</ul>
    <div class="tk-item-add">
      <label class="sr" for="tk-item-new">Novo item da checklist</label><input id="tk-item-new" name="text" form="ck-add" maxlength="200" required placeholder="+ Acrescentar item" autocomplete="off">
      <button class="btn mini" type="submit" form="ck-add">Acrescentar</button>
    </div>
  </div>`;
  const forms = html`<form method="post" action="${base}" id="ck-add" class="tk-item-addf" data-item-add></form>
    ${items.map((i) => itemForms(task.id, i))}
    <template id="ck-tpl">${itemRow(task.id, { id: 0, text: '', done: 0 })}${itemForms(task.id, { id: 0, done: 0 })}</template>`;
  return { body, forms };
}

function itemRow(taskId, i) {
  return html`<li class="tk-item${i.done ? ' done' : ''}" data-item="${i.id}">
      <button type="submit" form="ck-t-${i.id}" class="tk-box" role="checkbox" aria-checked="${i.done ? 'true' : 'false'}" aria-label="${i.text}">${i.done ? icon('certo', 'ico xs') : ''}</button>
      <span class="tk-item-t">${i.text}</span>
      <button type="submit" form="ck-d-${i.id}" class="btn link tk-item-del" aria-label="Apagar item: ${i.text}" title="Apagar item">×</button>
    </li>`;
}

function itemForms(taskId, i) {
  return html`<form method="post" action="/tarefas/${taskId}/itens/${i.id}" id="ck-t-${i.id}" class="tk-item-check" data-item-toggle="${i.id}"><input type="hidden" name="done" value="${i.done ? '0' : '1'}"></form>
    <form method="post" action="/tarefas/${taskId}/itens/${i.id}/apagar" id="ck-d-${i.id}" data-item-del="${i.id}"></form>`;
}
