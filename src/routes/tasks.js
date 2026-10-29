// Quadro de tarefas (experiência): colunas livres, arrastar para mudar de coluna ou de ordem,
// projeto, prazo e lembrete por notificação. Pode desligar-se em Administração → Sistema.
import { z } from 'zod';
import { html, raw } from '../html.js';
import { getExam, knownProjects } from '../repo.js';
import {
  boardTasks, createTask, deleteTask, firstColumn, getTask, listColumns, MAX_COLS, MIN_COLS, moveTask, saveColumns, taskProjects, tasksEnabled, updateTask,
} from '../tasks.js';
import { addDays, fmtDate, isDate, normTime, nowLocal, toIsoDate, todayLocal } from '../time.js';
import { dateInput, ERRORS, flash, help, icon, pageHead, postButton, timeInput } from '../ui.js';
import { idParam, safeBack, send, str } from './util.js';

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

export function taskCard(t, { today = todayLocal(), now = nowLocal(), back = '/tarefas', draggable = true } = {}) {
  return html`<li class="tk-card${t.done ? ' done' : ''}" data-task="${t.id}"${draggable ? raw(' draggable="true"') : ''}>
    <a class="tk-title" href="/tarefas/${t.id}">${t.title}</a>
    <div class="tk-meta">${t.project ? html`<span class="tk-proj">${t.project}</span>` : ''}${dueBadge(t, today)}${remindBadge(t, now)}${examRef(t)}${t.notes ? html`<span class="tk-notes" title="Tem notas">notas</span>` : ''}</div>
    ${!t.done ? html`<div class="tk-acts">${postButton(`/tarefas/${t.id}/mover`, 'Feito', { kind: 'mini', back, name: 'col', value: 'feito' })}</div>` : ''}
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
        <label class="span2">Notas <span class="opt">opcional</span><textarea name="notes" rows="4" maxlength="4000">${v.notes || ''}</textarea>${err('notes')}</label>
        <div class="span2 form-actions"><button class="btn primary" type="submit">${task ? 'Guardar' : 'Criar tarefa'}</button><a class="btn ghost" href="${linked && !task ? `/exames/${linked.id}` : '/tarefas'}">Cancelar</a></div>
      </form>
      ${task ? html`<div class="more-actions">${postButton(`/tarefas/${task.id}/apagar`, 'Apagar tarefa', { kind: 'danger', confirm: 'Apagar esta tarefa?' })}</div>` : ''}`,
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
    const byCol = Object.fromEntries(cols.map((c) => [c.id, c.is_done ? done : open.filter((t) => t.column_id === c.id)]));
    const late = open.filter((t) => t.due_date && t.due_date < today).length;
    return send(reply, req, {
      title: 'Tarefas',
      active: 'tarefas',
      wide: true,
      body: html`${pageHead('Tarefas', {
          sub: html`<span>${open.length} por fazer${late ? html` · <span class="late-txt">${late} ${late === 1 ? 'atrasada' : 'atrasadas'}</span>` : ''}</span>`,
          info: html`<p>Quadro livre para o seu trabalho: protocolos, pedidos a pessoas, o que tiver de fazer sobre um exame. As tarefas nunca mudam exames nem a agenda.</p><p><b>Arraste</b> para mudar de coluna ou de ordem. Com prazo ou lembrete, aparecem em «Hoje» e o lembrete chega como notificação (ative-as em A minha conta).</p><p>É uma experiência: pode desligar o quadro em Administração → Sistema, sem perder as tarefas.</p>`,
          actions: html`<a class="btn" href="/tarefas/colunas">Colunas</a><a class="btn primary" href="/tarefas/nova${project ? `?projeto=${encodeURIComponent(project)}` : ''}">Nova tarefa</a>`,
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
            <ul class="tk-cards" data-drop="${c.id}"${c.is_done ? raw(' data-done') : ''}>${byCol[c.id].map((t) => taskCard(t, { today, now, back }))}</ul>
            ${!byCol[c.id].length ? html`<p class="tk-none">${c.is_done ? 'Nada feito ainda.' : '—'}</p>` : ''}
            ${c.is_done && doneTotal > done.length ? html`<p class="muted small">Mostram-se as ${done.length} mais recentes de ${doneTotal}.</p>` : ''}
          </section>`)}
        </div>`,
    });
  });

  // Colunas: nome, ordem, quantas, e qual é a das concluídas.
  const colsPage = (req, cols, error = '') => {
    const rows = [...cols, { id: null, name: '', is_done: 0, n: 0, isNew: true }];
    const doneIdx = rows.findIndex((c) => c.is_done);
    return {
      title: 'Colunas das tarefas',
      active: 'tarefas',
      body: html`${pageHead('Colunas', { back: { href: '/tarefas', label: 'Tarefas' }, info: html`<p>Mude o nome, a ordem (setas) e o número de colunas (${MIN_COLS} a ${MAX_COLS}).</p><p>A coluna <b>de concluídas</b> é para onde vai o botão «Feito»; as tarefas lá não aparecem em «Hoje» nem enviam lembretes.</p><p>Para apagar uma coluna com tarefas, escolha para onde passam.</p>` })}
        ${error ? html`<div class="notice err" role="alert">${error}</div>` : ''}
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
          <div class="form-actions"><button class="btn primary" type="submit">Guardar colunas</button><a class="btn ghost" href="/tarefas">Cancelar</a></div>
        </form>`,
    };
  };

  const withCounts = () => listColumns(db).map((c) => ({ ...c, n: db.prepare('SELECT COUNT(*) FROM tasks WHERE column_id = ?').pluck().get(c.id) }));

  app.get('/tarefas/colunas', async (req, reply) => send(reply, req, colsPage(req, withCounts())));

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
    return reply.redirect('/tarefas?msg=colunas');
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
    return reply.redirect('/tarefas?msg=tarefa_apagada');
  });
}
