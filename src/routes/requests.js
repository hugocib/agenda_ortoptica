import { z } from 'zod';
import { html, raw } from '../html.js';
import { audit } from '../db.js';
import { createRequest, examsWhere, getRequest, listExamTypes, setClinicalInfo, transitionExam, updatePatient } from '../repo.js';
import { ORIGIN_LABEL } from '../domain/status.js';
import { fmtDate, fmtDateTime, fmtUtcLocal, isDate, toIsoDate, todayLocal } from '../time.js';
import { dateInput, emptyState, examLine, flash, originTag, pageHead, patientLabel, postButton, track, when } from '../ui.js';
import { arr, idParam, safeBack, send, str } from './util.js';

const RequestSchema = z.object({
  patient_process: z.string().trim().min(1, 'Indique o n.º de processo do Siima.').max(40, 'Demasiado longo.'),
  patient_name: z.string().trim().max(120, 'Demasiado longo.'),
  birth_date: z.string().trim().refine((v) => v === '' || (isDate(v) && v >= '1900-01-01' && v <= todayLocal()), 'Data de nascimento inválida.'),
  origin: z.enum(['externo', 'projeto', 'ensaio'], { message: 'Escolha a origem.' }),
  project: z.string().trim().max(120, 'Demasiado longo.'),
  referrer: z.string().trim().max(160, 'Demasiado longo.'),
  priority: z.enum(['normal', 'urgente']),
  notes: z.string().trim().max(2000, 'Notas demasiado longas.'),
  clinical_info: z.string().trim().max(2000, 'Demasiado longo.'),
  requisition: z.string().trim().max(40, 'Demasiado longo.'),
}).superRefine((v, ctx) => {
  if (v.origin !== 'externo' && !v.project) ctx.addIssue({ code: 'custom', path: ['project'], message: 'Indique o projeto ou estudo.' });
});

function fieldErr(errors, k) {
  return errors[k] ? html`<span class="field-err">${errors[k]}</span>` : '';
}

function newForm(req, types, values = {}, errors = {}) {
  const v = { origin: 'externo', priority: 'normal', ...values };
  const selected = new Set(arr(values.exam_type_id));
  const err = (k) => fieldErr(errors, k);
  const inv = (k) => (errors[k] ? html` aria-invalid="true"` : '');
  return {
    title: 'Novo pedido',
    active: 'pedidos',
    body: html`${pageHead('Novo pedido', { back: { href: '/pedidos', label: 'Pedidos' }, info: 'Para exames fora do circuito do secretariado: fazem o percurso completo, incluindo a marcação no Siima. O doente fica identificado pelo n.º de processo.' })}
      ${Object.keys(errors).length ? html`<div class="notice err" role="alert">Corrija os campos assinalados.</div>` : ''}
      <form method="post" action="/pedidos" class="sheet form-grid guarded" novalidate>
        <fieldset class="span2">
          <legend>Doente / participante</legend>
          <div class="grid3">
            <label>N.º de processo (Siima) *<input name="patient_process" required maxlength="40" value="${v.patient_process || ''}" autofocus inputmode="numeric" autocomplete="off" class="mono"${inv('patient_process')}>${err('patient_process')}</label>
            <label>Nome <span class="opt">opcional</span><input name="patient_name" maxlength="120" value="${v.patient_name || ''}" autocomplete="off"${inv('patient_name')}>${err('patient_name')}</label>
            <label>Data de nascimento <span class="opt">opcional</span>${dateInput('birth_date', v.birth_date || '', { invalid: Boolean(errors.birth_date) })}${err('birth_date')}</label>
          </div>
        </fieldset>
        <fieldset class="span2">
          <legend>Exames *</legend>
          ${err('exam_type_id')}
          <div class="picks">${types.map((t) => html`<label class="pick">
            <input type="checkbox" name="exam_type_id" value="${t.id}"${selected.has(String(t.id)) ? html` checked` : ''}>
            <span class="pick-n">${t.name}<small>${t.minutes} min${t.max_per_day ? ` · máx. ${t.max_per_day} por dia` : ''}</small></span></label>`)}</div>
        </fieldset>
        <fieldset>
          <legend>Origem *</legend>
          <div class="seg" role="radiogroup" aria-label="Origem">${Object.entries(ORIGIN_LABEL).map(([k, label]) => html`<label><input type="radio" name="origin" value="${k}"${v.origin === k ? html` checked` : ''}> ${label}</label>`)}</div>
          <label>Projeto / estudo <span class="opt">obrigatório se não for externo</span><input name="project" maxlength="120" value="${v.project || ''}"${inv('project')}>${err('project')}</label>
        </fieldset>
        <fieldset>
          <legend>Requisição</legend>
          <label>N.º de requisição (Siima) <span class="opt">opcional; pode pôr depois</span><input name="requisition" maxlength="40" value="${v.requisition || ''}" class="mono" autocomplete="off"${inv('requisition')}>${err('requisition')}</label>
          <label>Requisitante <span class="opt">médico ou entidade</span><input name="referrer" maxlength="160" value="${v.referrer || ''}"></label>
          <div class="seg" role="radiogroup" aria-label="Prioridade"><label><input type="radio" name="priority" value="normal"${v.priority !== 'urgente' ? html` checked` : ''}> Normal</label>
          <label class="urg"><input type="radio" name="priority" value="urgente"${v.priority === 'urgente' ? html` checked` : ''}> Urgente</label></div>
        </fieldset>
        <label class="span2">Informação clínica <span class="opt">suspeita ou observações do médico requisitante; sai no relatório</span><textarea name="clinical_info" rows="2" maxlength="2000">${v.clinical_info || ''}</textarea>${err('clinical_info')}</label>
        <label class="span2">Notas <span class="opt">internas, não saem no relatório</span><textarea name="notes" rows="2" maxlength="2000">${v.notes || ''}</textarea>${err('notes')}</label>
        <div class="span2 form-actions sticky"><button class="btn primary big" type="submit">Criar pedido e escolher hora</button><a class="btn ghost" href="/hoje">Cancelar</a></div>
      </form>`,
  };
}

export default async function requestRoutes(app, { db }) {
  app.get('/pedidos', async (req, reply) => {
    const filtro = ['por_agendar', 'investigacao', 'todos'].includes(req.query.f) ? req.query.f : 'por_agendar';
    const q = str(req.query.q).trim().slice(0, 60);
    let rows;
    if (q) {
      rows = examsWhere(db, '(r.patient_process LIKE ? OR r.patient_name LIKE ? OR r.project LIKE ? OR e.requisition LIKE ?)', [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`], 'e.created_at DESC', 200);
    } else if (filtro === 'investigacao') {
      rows = examsWhere(db, "r.source = 'investigacao'", [], 'e.starts_at DESC', 200);
    } else if (filtro === 'por_agendar') {
      rows = examsWhere(db, "e.status = 'por_agendar'", [], "r.priority = 'urgente' DESC, e.created_at", 200);
    } else {
      rows = examsWhere(db, '1 = 1', [], 'e.created_at DESC', 200);
    }
    const today = todayLocal();
    return send(reply, req, {
      title: 'Pedidos',
      active: 'pedidos',
      body: html`${pageHead('Pedidos', { actions: html`<a class="btn" href="/investigacao/nova">Nova avaliação de investigação</a><a class="btn primary" href="/pedidos/novo">Novo pedido</a>` })}
        ${flash(req.query, req)}
        <div class="toolbar">
          <nav class="tabs" aria-label="Filtro"><a href="/pedidos?f=por_agendar" class="${!q && filtro === 'por_agendar' ? 'active' : ''}"${!q && filtro === 'por_agendar' ? raw(' aria-current="page"') : ''}>Por agendar</a><a href="/pedidos?f=investigacao" class="${!q && filtro === 'investigacao' ? 'active' : ''}"${!q && filtro === 'investigacao' ? raw(' aria-current="page"') : ''}>Investigação</a><a href="/pedidos?f=todos" class="${!q && filtro === 'todos' ? 'active' : ''}"${!q && filtro === 'todos' ? raw(' aria-current="page"') : ''}>Todos <span class="muted small">últimos 200</span></a></nav>
          <form method="get" action="/pedidos" class="search" role="search"><input type="search" name="q" value="${q}" placeholder="Requisição, processo, nome, código ou projeto" aria-label="Pesquisar por requisição, processo, nome, código do participante ou projeto"><button class="btn" type="submit">Pesquisar</button></form>
        </div>
        ${q ? html`<p class="sec-note">${rows.length} ${rows.length === 1 ? 'resultado' : 'resultados'} para «${q}» · <a href="/pedidos">limpar pesquisa</a></p>` : ''}
        ${rows.length ? html`<table class="table rt">
          <thead><tr><th>Exame e doente</th><th>Percurso</th><th>Data</th><th>Origem do pedido</th><th></th></tr></thead>
          <tbody>${rows.map((e) => html`<tr class="s-${e.status}">
            <td class="main-cell"><a class="ex-title" href="/exames/${e.id}">${e.type_name}</a>${e.priority === 'urgente' && e.status === 'por_agendar' ? html` <span class="urgent">Urgente</span>` : ''}
              <div class="ex-meta">${patientLabel(e)}${originTag(e.origin, e.project, e.source)}</div></td>
            <td>${track(e, { today })}</td>
            <td><span class="when">${e.starts_at ? when(e) : ''}</span></td>
            <td>${e.source === 'secretariado' ? html`<span class="small">Secretariado${e.booked_by_name ? ` · ${e.booked_by_name}` : ''}</span>` : e.source === 'investigacao' ? html`<span class="small">Investigação</span>` : html`<a href="/pedidos/${e.request_id}" class="mono">#${e.request_id}</a>`} <span class="muted small">${fmtDate(e.created_at)}</span></td>
            <td class="right act">${e.status === 'por_agendar' ? html`<a class="btn primary" href="/exames/${e.id}/agendar">Agendar</a>` : ''}</td></tr>`)}</tbody></table>`
          : q ? emptyState(`Nenhum exame com «${q}».`, html`Procure pelo n.º de requisição, de processo, parte do nome ou do projeto.`)
            : filtro === 'por_agendar' ? html`<p class="empty clear">Nada por agendar.</p>`
              : filtro === 'investigacao' ? emptyState('Ainda não há avaliações de investigação.', html`<a class="btn primary" href="/investigacao/nova">Registar a primeira</a>`) : emptyState('Ainda não há pedidos.')}`,
    });
  });

  app.get('/pedidos/novo', async (req, reply) => send(reply, req, newForm(req, listExamTypes(db))));

  app.post('/pedidos', async (req, reply) => {
    const body = req.body || {};
    const values = Object.fromEntries(['patient_process', 'patient_name', 'birth_date', 'origin', 'project', 'referrer', 'priority', 'notes', 'clinical_info', 'requisition'].map((k) => [k, str(body[k])]));
    values.birth_date = toIsoDate(values.birth_date);
    values.exam_type_id = arr(body.exam_type_id);
    const parsed = RequestSchema.safeParse(values);
    const errors = {};
    if (!parsed.success) for (const i of parsed.error.issues) errors[i.path[0]] ??= i.message;
    const activeIds = new Set(listExamTypes(db).map((t) => t.id));
    const typeIds = [...new Set(values.exam_type_id.map(Number))].filter((n) => activeIds.has(n));
    if (!typeIds.length) errors.exam_type_id = 'Escolha pelo menos um exame.';
    if (Object.keys(errors).length) return send(reply, req, newForm(req, listExamTypes(db), values, errors), 400);

    const { requisition, ...data } = { ...parsed.data, birth_date: parsed.data.birth_date || null };
    const requestId = createRequest(db, req.user, data, typeIds, requisition);
    const exams = db.prepare('SELECT id FROM exams WHERE request_id = ?').pluck().all(requestId);
    // Um só exame: segue logo para a escolha da hora.
    if (exams.length === 1) return reply.redirect(`/exames/${exams[0]}/agendar?msg=criado`);
    return reply.redirect(`/pedidos/${requestId}?msg=criado`);
  });

  app.get('/pedidos/:id', async (req, reply) => {
    const id = idParam(req);
    const r = id && getRequest(db, id);
    if (!r) return reply.callNotFound();
    if (r.source === 'investigacao') {
      const examId = db.prepare('SELECT id FROM exams WHERE request_id = ?').pluck().get(id);
      return reply.redirect(`/exames/${examId}`);
    }
    const exams = examsWhere(db, 'e.request_id = ?', [id], 'e.id');
    const back = `/pedidos/${id}`;
    const today = todayLocal();
    return send(reply, req, {
      title: `Pedido #${id}`,
      active: 'pedidos',
      body: html`${pageHead(html`Pedido <span class="mono">#${id}</span>`, { back: { href: '/pedidos', label: 'Pedidos' }, sub: html`${patientLabel(r)}${originTag(r.origin, r.project, r.source)}${r.priority === 'urgente' ? html`<span class="urgent">Urgente</span>` : ''}` })}
        ${flash(req.query, req)}
        <section class="sec">
          <div class="sec-h"><h2>Exames</h2><span class="count">${exams.length}</span></div>
          <ul class="list">${exams.map((e) => html`<li>${examLine(e, { today, when: true, actions: html`
              ${e.status === 'por_agendar' ? html`<a class="btn primary" href="/exames/${e.id}/agendar">Agendar</a>` : ''}
              ${e.status === 'agendado' && !e.siima_booked_at ? postButton(`/exames/${e.id}/siima-marcado`, 'Marcado no Siima', { kind: 'owed', back }) : ''}
              ${e.status === 'agendado' ? html`<a class="btn" href="/exames/${e.id}/agendar">Reagendar</a>` : ''}` })}</li>`)}</ul>
        </section>
        <section class="sec quiet">
          <div class="sec-h"><h2>Requisição</h2></div>
          <dl class="facts">
            <div><dt>Processo</dt><dd class="proc">${r.patient_process}</dd></div>
            ${r.patient_name ? html`<div><dt>Nome</dt><dd>${r.patient_name}</dd></div>` : ''}
            ${r.birth_date ? html`<div><dt>Nascimento</dt><dd>${fmtDate(r.birth_date)}</dd></div>` : ''}
            <div><dt>Origem</dt><dd>${ORIGIN_LABEL[r.origin]}${r.project ? ` — ${r.project}` : ''}</dd></div>
            ${r.referrer ? html`<div><dt>Requisitante</dt><dd>${r.referrer}</dd></div>` : ''}
            <div><dt>Prioridade</dt><dd>${r.priority === 'urgente' ? 'Urgente' : 'Normal'}</dd></div>
            <div><dt>Criado</dt><dd>${fmtUtcLocal(r.created_at)} · ${r.created_by_name || r.booked_by_name || '—'}</dd></div>
          </dl>
          ${r.clinical_info ? html`<h3 class="day-label">Informação clínica</h3><p class="notes">${r.clinical_info}</p>` : ''}
          ${r.notes ? html`<h3 class="day-label">Notas</h3><p class="notes">${r.notes}</p>` : ''}
          ${exams.some((e) => ['por_agendar', 'agendado'].includes(e.status))
            ? html`<div class="more-actions">${postButton(`/pedidos/${id}/cancelar`, 'Cancelar exames pendentes deste pedido', { kind: 'danger', confirm: 'Cancelar todos os exames ainda não realizados deste pedido?' })}</div>` : ''}
        </section>`,
    });
  });

  // Identificação do doente (sobretudo para reservas do secretariado, que chegam sem ela).
  const PatientSchema = z.object({
    patient_process: z.string().trim().max(40),
    patient_name: z.string().trim().max(120),
    birth_date: z.string().trim().refine((v) => v === '' || (isDate(v) && v >= '1900-01-01' && v <= todayLocal())),
    origin: z.enum(['externo', 'projeto', 'ensaio']),
    project: z.string().trim().max(120),
  });
  app.post('/pedidos/:id/doente', async (req, reply) => {
    const id = idParam(req);
    const r = id && getRequest(db, id);
    if (!r) return reply.callNotFound();
    const back = safeBack(req.body?.back, `/pedidos/${id}`);
    const parsed = PatientSchema.safeParse(Object.fromEntries(['patient_process', 'patient_name', 'birth_date', 'origin', 'project'].map((k) => [k, k === 'birth_date' ? toIsoDate(str(req.body?.[k])) : str(req.body?.[k])])));
    // Um pedido direto tem sempre de manter o n.º de processo.
    if (!parsed.success || (r.source === 'direto' && !parsed.data.patient_process)) return reply.redirect(`${back.split('?')[0]}?err=dados_invalidos`);
    updatePatient(db, req.user, id, { ...parsed.data, birth_date: parsed.data.birth_date || null });
    return reply.redirect(`${back.split('?')[0]}?msg=doente`);
  });

  app.post('/pedidos/:id/informacao-clinica', async (req, reply) => {
    const id = idParam(req);
    const r = id && getRequest(db, id);
    if (!r || r.source === 'investigacao') return reply.callNotFound();
    const back = safeBack(req.body?.back, `/pedidos/${id}`).split('?')[0];
    setClinicalInfo(db, req.user, id, str(req.body?.clinical_info));
    return reply.redirect(`${back}?msg=info_clinica`);
  });

  app.post('/pedidos/:id/cancelar', async (req, reply) => {
    const id = idParam(req);
    if (!id || !getRequest(db, id)) return reply.callNotFound();
    const pending = db.prepare("SELECT id FROM exams WHERE request_id = ? AND status IN ('por_agendar','pendente','agendado')").pluck().all(id);
    for (const examId of pending) transitionExam(db, req.user, examId, 'cancelar');
    audit(db, req.user.id, 'cancelar', 'pedido', id, { exames: pending.length });
    return reply.redirect(`/pedidos/${id}?msg=cancelado`);
  });
}

