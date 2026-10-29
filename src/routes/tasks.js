// Quadro de tarefas (experiência): colunas livres, arrastar para mudar de coluna ou de ordem,
// projeto, prazo e lembrete por notificação. Pode desligar-se em Administração → Sistema.
import { z } from 'zod';
import { html, raw } from '../html.js';
import { getExam, knownProjects } from '../repo.js';
import {
  boardTasks, COL_KEYS, createTask, deleteTask, getTask, moveTask, TASK_COLS, taskProjects, tasksEnabled, updateTask,
} from '../tasks.js';
import { addDays, fmtDate, isDate, isTime, nowLocal, toIsoDate, todayLocal } from '../time.js';
import { dateInput, flash, icon, pageHead, postButton, timeSelect } from '../ui.js';
import { idParam, safeBack, send, str } from './util.js';

const Schema = z.object({
  title: z.string().trim().min(1, 'Escreva a tarefa.').max(200, 'Demasiado longo (máx. 200).'),
  notes: z.string().trim().max(4000, 'Notas demasiado longas.'),
  project: z.string().trim().max(120, 'Demasiado longo.'),
  col: z.enum(COL_KEYS),
  due_date: z.string().refine((v) => v === '' || isDate(v), 'Data inválida (dd/mm/aaaa).'),
  remind_date: z.string().refine((v) => v === '' || isDate(v), 'Data inválida (dd/mm/aaaa).'),
  remind_time: z.string().refine((v) => v === '' || isTime(v), 'Hora inválida.'),
}).superRefine((v, ctx) => {
  if (Boolean(v.remind_date) !== Boolean(v.remind_time)) ctx.addIssue({ code: 'custom', path: ['remind_date'], message: 'Indique o dia e a hora do lembrete (ou nenhum).' });
});

const COL_LABEL = Object.fromEntries(TASK_COLS.map((c) => [c.key, c.label]));
const ddmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function dueBadge(t, today) {
  if (!t.due_date || t.col === 'feito') return t.due_date ? html`<span class="tk-due">${ddmm(t.due_date)}</span>` : '';
  const cls = t.due_date < today ? 'late' : t.due_date === today ? 'today' : '';
  const txt = t.due_date < today ? `atrasada · ${ddmm(t.due_date)}` : t.due_date === today ? 'hoje' : t.due_date === addDays(today, 1) ? 'amanhã' : ddmm(t.due_date);
  return html`<span class="tk-due ${cls}" title="Prazo">${txt}</span>`;
}

function remindBadge(t, now) {
  if (!t.remind_at || t.col === 'feito') return '';
  const past = t.remind_at <= now;
  return html`<span class="tk-rem${past ? ' past' : ''}" title="${past ? 'Lembrete já enviado' : 'Lembrete'}">${icon('sino', 'ico xs')}${ddmm(t.remind_at)} ${t.remind_at.slice(11)}</span>`;
}

function examRef(t) {
  if (!t.exam_id || !t.exam_type_name) return '';
  return html`<a class="tk-exam" href="/exames/${t.exam_id}">${t.exam_type_name}${t.exam_starts_at ? ` · ${ddmm(t.exam_starts_at)}` : ''}</a>`;
}

export function taskCard(t, { today = todayLocal(), now = nowLocal(), back = '/tarefas', draggable = true } = {}) {
  return html`<li class="tk-card${t.col === 'feito' ? ' done' : ''}" data-task="${t.id}"${draggable ? raw(' draggable="true"') : ''}>
    <a class="tk-title" href="/tarefas/${t.id}">${t.title}</a>
    <div class="tk-meta">${t.project ? html`<span class="tk-proj">${t.project}</span>` : ''}${dueBadge(t, today)}${remindBadge(t, now)}${examRef(t)}${t.notes ? html`<span class="tk-notes" title="Tem notas">notas</span>` : ''}</div>
    ${t.col !== 'feito' ? html`<div class="tk-acts">${postButton(`/tarefas/${t.id}/mover`, 'Feito', { kind: 'mini', back, name: 'col', value: 'feito' })}</div>` : ''}
  </li>`;
}

function form(req, db, { task = null, values = {}, errors = {}, exam = null }) {
  const v = { col: 'afazer', ...values };
  const err = (k) => (errors[k] ? html`<span class="field-err">${errors[k]}</span>` : '');
  const inv = (k) => (errors[k] ? raw(' aria-invalid="true"') : '');
  const projects = [...new Set([...taskProjects(db), ...knownProjects(db)])];
  const today = todayLocal();
  const title = task ? 'Tarefa' : 'Nova tarefa';
  const linked = exam || (task?.exam_id ? { id: task.exam_id, type_name: task.exam_type_name, starts_at: task.exam_starts_at } : null);
  return {
    title,
    active: 'tarefas',
    body: html`${pageHead(title, { back: { href: '/tarefas', label: 'Tarefas' } })}
      ${flash(req.query, req)}
      ${Object.keys(errors).length ? html`<div class="notice err" role="alert">Corrija os campos assinalados.</div>` : ''}
      <form method="post" action="${task ? `/tarefas/${task.id}` : '/tarefas'}" class="sheet form-grid guarded" novalidate>
        <label class="span2">Tarefa *<input name="title" required maxlength="200" value="${v.title || ''}"${task ? '' : raw(' autofocus')}${inv('title')}>
          <span class="fhint">Aparece nas notificações: não escreva dados de doentes. Para um exame, use a ligação abaixo.</span>${err('title')}</label>
        <label>Projeto <span class="opt">opcional</span><input name="project" maxlength="120" value="${v.project || ''}" list="tk-projetos" autocomplete="off"${inv('project')}>${err('project')}</label>
        <datalist id="tk-projetos">${projects.map((p) => html`<option value="${p}">`)}</datalist>
        <label>Coluna<select name="col">${TASK_COLS.map((c) => html`<option value="${c.key}"${v.col === c.key ? raw(' selected') : ''}>${c.label}</option>`)}</select></label>
        <label>Prazo <span class="opt">opcional</span>${dateInput('due_date', v.due_date || '', { invalid: Boolean(errors.due_date) })}${err('due_date')}</label>
        <fieldset class="tk-remind">
          <legend>Lembrete <span class="opt">opcional</span></legend>
          <span class="fhint">Chega como notificação aos dispositivos onde as ativou, e a tarefa aparece em «Hoje».</span>
          <div class="toolbar">
            <label><span class="sr">Dia do lembrete</span>${dateInput('remind_date', v.remind_date || '', { invalid: Boolean(errors.remind_date), label: 'Dia do lembrete' })}</label>
            <label><span class="sr">Hora do lembrete</span>${timeSelect('remind_time', v.remind_time || '', { from: '07:00', to: '22:00', step: 15, label: 'Hora do lembrete' })}</label>
          </div>
          <div class="chips" data-remind-presets>
            <button type="button" class="btn mini ghost" data-remind="${today}T17:00">Hoje 17:00</button>
            <button type="button" class="btn mini ghost" data-remind="${addDays(today, 1)}T09:00">Amanhã 09:00</button>
            <button type="button" class="btn mini ghost" data-remind="due">No prazo, 09:00</button>
            <button type="button" class="btn mini ghost" data-remind="">Sem lembrete</button>
          </div>
          ${err('remind_date')}
          ${task?.reminded_at ? html`<p class="fhint">Lembrete já enviado. Mudar o dia ou a hora volta a ativá-lo.</p>` : ''}
        </fieldset>
        ${linked ? html`<div class="span2 tk-link"><input type="hidden" name="exam_id" value="${linked.id}">
          <span>Ligada ao exame <a href="/exames/${linked.id}">${linked.type_name || `n.º ${linked.id}`}${linked.starts_at ? ` · ${fmtDate(linked.starts_at)} ${linked.starts_at.slice(11)}` : ''}</a></span>
          <label class="check"><input type="checkbox" name="unlink" value="1"> <span>Desligar do exame</span></label></div>` : ''}
        <label class="span2">Notas <span class="opt">opcional</span><textarea name="notes" rows="4" maxlength="4000">${v.notes || ''}</textarea>${err('notes')}</label>
        <div class="span2 form-actions"><button class="btn primary" type="submit">${task ? 'Guardar' : 'Criar tarefa'}</button><a class="btn ghost" href="${linked && !task ? `/exames/${linked.id}` : '/tarefas'}">Cancelar</a></div>
      </form>
      ${task ? html`<div class="more-actions">${postButton(`/tarefas/${task.id}/apagar`, 'Apagar tarefa', { kind: 'danger', confirm: 'Apagar esta tarefa?' })}</div>` : ''}`,
  };
}

function parse(db, body) {
  const values = Object.fromEntries(['title', 'notes', 'project', 'col', 'due_date', 'remind_date', 'remind_time'].map((k) => [k, str(body?.[k])]));
  values.due_date = toIsoDate(values.due_date);
  values.remind_date = toIsoDate(values.remind_date);
  if (!values.col) values.col = 'afazer';
  const parsed = Schema.safeParse(values);
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
      title: d.title, notes: d.notes, project: d.project, col: d.col,
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
    const byCol = Object.fromEntries(TASK_COLS.map((c) => [c.key, c.key === 'feito' ? done : open.filter((t) => t.col === c.key)]));
    const late = open.filter((t) => t.due_date && t.due_date < today).length;
    return send(reply, req, {
      title: 'Tarefas',
      active: 'tarefas',
      wide: true,
      body: html`${pageHead('Tarefas', {
          sub: html`<span>${open.length} por fazer${late ? html` · <span class="late-txt">${late} ${late === 1 ? 'atrasada' : 'atrasadas'}</span>` : ''}</span>`,
          info: html`<p>Quadro livre para o seu trabalho: protocolos, pedidos a pessoas, o que tiver de fazer sobre um exame. As tarefas nunca mudam exames nem a agenda.</p><p><b>Arraste</b> para mudar de coluna ou de ordem. Com prazo ou lembrete, aparecem em «Hoje» e o lembrete chega como notificação (ative-as em A minha conta).</p><p>É uma experiência: pode desligar o quadro em Administração → Sistema, sem perder as tarefas.</p>`,
          actions: html`<a class="btn primary" href="/tarefas/nova${project ? `?projeto=${encodeURIComponent(project)}` : ''}">Nova tarefa</a>`,
        })}
        ${flash(req.query, req)}
        ${projects.length ? html`<nav class="chips tk-filter" aria-label="Filtrar por projeto"><a class="chip${project ? '' : ' active'}" href="/tarefas"${project ? '' : raw(' aria-current="page"')}>Todas</a>${projects.map((p) => html`<a class="chip${p === project ? ' active' : ''}" href="/tarefas?projeto=${encodeURIComponent(p)}"${p === project ? raw(' aria-current="page"') : ''}>${p}</a>`)}</nav>` : ''}
        <div class="tk-board" data-tasks data-back="${back}">
          ${TASK_COLS.map((c) => html`<section class="tk-col" data-col="${c.key}" aria-labelledby="tk-h-${c.key}">
            <h2 class="tk-col-h" id="tk-h-${c.key}">${c.label}<span class="count">${c.key === 'feito' ? doneTotal : byCol[c.key].length}</span></h2>
            ${c.key === 'afazer' ? html`<form method="post" action="/tarefas" class="tk-quick">
              <input type="hidden" name="col" value="afazer"><input type="hidden" name="project" value="${project}"><input type="hidden" name="back" value="${back}">
              <label class="sr" for="tk-q">Nova tarefa</label><input id="tk-q" name="title" maxlength="200" required placeholder="+ Nova tarefa">
              <button class="btn mini" type="submit">Adicionar</button></form>` : ''}
            <ul class="tk-cards" data-drop="${c.key}">${byCol[c.key].map((t) => taskCard(t, { today, now, back }))}</ul>
            ${!byCol[c.key].length ? html`<p class="tk-none">${c.key === 'feito' ? 'Nada feito ainda.' : '—'}</p>` : ''}
            ${c.key === 'feito' && doneTotal > done.length ? html`<p class="muted small">Mostram-se as ${done.length} mais recentes de ${doneTotal}.</p>` : ''}
          </section>`)}
        </div>`,
    });
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
    return reply.redirect(`${back.split('#')[0]}${back.includes('?') ? '&' : '?'}${res.ok ? `msg=${col === 'feito' ? 'tarefa_feita' : 'tarefa_guardada'}` : 'err=dados_invalidos'}`);
  });

  app.post('/tarefas/:id/apagar', async (req, reply) => {
    const id = idParam(req);
    if (!id) return reply.callNotFound();
    deleteTask(db, req.user, id);
    return reply.redirect('/tarefas?msg=tarefa_apagada');
  });
}
