// Avaliações de investigação: participantes de projetos, identificados só pelo código do estudo.
// Marcam-se a qualquer hora (fora do horário de exames externos, ou mesmo depois de feitas) e
// ocupam a hora no link do secretariado. Não passam pelo Siima.
import { z } from 'zod';
import { html, raw } from '../html.js';
import { createResearch, getExam, knownProjects, listExamTypes, updateResearch } from '../repo.js';
import { REASONS } from '../domain/slots.js';
import { fmtDuration } from '../domain/tape.js';
import { isDate, isTime, toIsoDate, todayLocal } from '../time.js';
import { dateInput, pageHead, timeSelect } from '../ui.js';
import { idParam, send, str } from './util.js';

const Schema = z.object({
  code: z.string().trim().min(1, 'Indique o código do participante.').max(40, 'Demasiado longo.')
    .refine((v) => !/\s{2,}/.test(v), 'Código inválido.'),
  project: z.string().trim().min(1, 'Indique o projeto.').max(120, 'Demasiado longo.'),
  typeId: z.coerce.number().int().positive({ message: 'Escolha o tipo de avaliação.' }),
  date: z.string().refine(isDate, 'Data inválida (dd/mm/aaaa).'),
  time: z.string().refine(isTime, 'Escolha a hora de início.'),
  minutes: z.union([z.literal(''), z.coerce.number().int().min(5, 'Mínimo 5 min.').max(600, 'Máximo 10 h.')]),
  notes: z.string().trim().max(2000, 'Notas demasiado longas.'),
});

const FIELDS = ['code', 'project', 'typeId', 'date', 'time', 'minutes', 'notes'];

function durationOptions(current) {
  const opts = [];
  for (let m = 10; m <= 240; m += m < 60 ? 5 : 15) opts.push(m);
  for (const m of [270, 300, 360, 420, 480]) opts.push(m);
  if (current && !opts.includes(current)) { opts.push(current); opts.sort((a, b) => a - b); }
  return opts;
}

function form(req, db, { values = {}, errors = {}, exam = null }) {
  const types = listExamTypes(db, { kind: 'investigacao', activeOnly: !exam });
  const projects = knownProjects(db);
  const v = { date: todayLocal(), ...values };
  const err = (k) => (errors[k] ? html`<span class="field-err">${errors[k]}</span>` : '');
  const inv = (k) => (errors[k] ? raw(' aria-invalid="true"') : '');
  const minutes = v.minutes === '' || v.minutes === undefined ? '' : Number(v.minutes);
  const action = exam ? `/investigacao/${exam.id}` : '/investigacao';
  const title = exam ? 'Alterar avaliação' : 'Nova avaliação de investigação';
  return {
    title,
    active: 'pedidos',
    body: html`${pageHead(title, {
        back: exam ? { href: `/exames/${exam.id}`, label: exam.type_name } : { href: '/pedidos?f=investigacao', label: 'Investigação' },
        info: html`<p>Para participantes de projetos de investigação. Fica identificado só pelo <b>código do estudo</b>: sem nome nem data de nascimento.</p><p>Pode marcar a qualquer hora, também fora do horário de exames externos, ou registar depois de feita. Se calhar numa manhã de exames externos, essa hora deixa de aparecer livre no link do secretariado.</p>`,
      })}
      ${Object.keys(errors).length ? html`<div class="notice err" role="alert">${errors._ || 'Corrija os campos assinalados.'}</div>` : ''}
      ${types.length ? '' : html`<div class="notice warn"><p>Ainda não há tipos de avaliação de investigação. Crie-os em <a href="/admin/exames#investigacao">Administração → Atos / MCDTs</a>.</p></div>`}
      <form method="post" action="${action}" class="sheet form-grid guarded" novalidate>
        <fieldset class="span2">
          <legend>Participante</legend>
          <div class="grid3">
            <label>Código do participante *<input name="code" required maxlength="40" value="${v.code || ''}" class="mono" autocomplete="off" placeholder="p. ex. NCSF-012"${exam ? '' : raw(' autofocus')}${inv('code')}>${err('code')}</label>
            <label class="w2">Projeto *<input name="project" required maxlength="120" value="${v.project || ''}" list="projetos" autocomplete="off"${inv('project')}>${err('project')}</label>
          </div>
          <datalist id="projetos">${projects.map((p) => html`<option value="${p}">`)}</datalist>
        </fieldset>
        <fieldset class="span2">
          <legend>Avaliação</legend>
          <div class="grid3">
            <label class="w2">Tipo de avaliação *<select name="typeId" required${inv('typeId')}><option value="">—</option>${types.map((t) => html`<option value="${t.id}"${Number(v.typeId) === t.id ? raw(' selected') : ''}>${t.name} · ${fmtDuration(t.minutes)}</option>`)}</select>${err('typeId')}</label>
            <label>Duração<select name="minutes"${inv('minutes')}><option value="">a do tipo</option>${durationOptions(minutes).map((m) => html`<option value="${m}"${m === minutes ? raw(' selected') : ''}>${fmtDuration(m)}</option>`)}</select>${err('minutes')}</label>
            <label>Data *${dateInput('date', v.date, { required: true, invalid: Boolean(errors.date) })}${err('date')}</label>
            <label>Início *${timeSelect('time', v.time || '', { from: '07:00', to: '21:00', step: 5 })}${err('time')}</label>
          </div>
        </fieldset>
        <label class="span2">Notas <span class="opt">opcional; sem dados que identifiquem o participante</span><textarea name="notes" rows="2" maxlength="2000">${v.notes || ''}</textarea>${err('notes')}</label>
        <div class="span2 form-actions"><button class="btn primary" type="submit">${exam ? 'Guardar alterações' : 'Registar avaliação'}</button><a class="btn ghost" href="${exam ? `/exames/${exam.id}` : '/pedidos?f=investigacao'}">Cancelar</a></div>
      </form>`,
  };
}

function parse(body) {
  const values = Object.fromEntries(FIELDS.map((k) => [k, str(body?.[k])]));
  values.date = toIsoDate(values.date);
  const parsed = Schema.safeParse(values);
  const errors = {};
  if (!parsed.success) for (const i of parsed.error.issues) errors[i.path[0]] ??= i.message;
  return { values, errors, data: parsed.success ? parsed.data : null };
}

function slotError(db, res) {
  if (res.reason === 'sobreposicao' && res.with) {
    const other = getExam(db, res.with.id);
    if (other) return `Sobrepõe-se a ${other.type_name} das ${other.starts_at.slice(11)} às ${other.ends_at.slice(11)}.`;
  }
  return REASONS[res.reason] || 'Não foi possível guardar.';
}

export default async function researchRoutes(app, { db }) {
  app.get('/investigacao/nova', async (req, reply) => {
    const date = isDate(str(req.query.data)) ? str(req.query.data) : todayLocal();
    return send(reply, req, form(req, db, { values: { date, project: str(req.query.projeto).slice(0, 120) } }));
  });

  app.post('/investigacao', async (req, reply) => {
    const { values, errors, data } = parse(req.body);
    if (!data) return send(reply, req, form(req, db, { values, errors }), 400);
    const res = createResearch(db, req.user, {
      code: data.code, project: data.project, typeId: data.typeId, startsAt: `${data.date}T${data.time}`,
      minutes: data.minutes === '' ? null : data.minutes, notes: data.notes,
    });
    if (!res.ok) {
      const e = res.reason === 'dados_invalidos' ? { typeId: 'Escolha o tipo de avaliação.' } : { time: slotError(db, res), _: slotError(db, res) };
      return send(reply, req, form(req, db, { values, errors: e }), 400);
    }
    return reply.redirect(`/exames/${res.id}?msg=avaliacao`);
  });

  app.get('/investigacao/:id/editar', async (req, reply) => {
    const id = idParam(req);
    const e = id && getExam(db, id);
    if (!e || e.source !== 'investigacao') return reply.callNotFound();
    return send(reply, req, form(req, db, {
      exam: e,
      values: { code: e.patient_process, project: e.project, typeId: e.exam_type_id, date: e.starts_at?.slice(0, 10), time: e.starts_at?.slice(11), minutes: e.minutes, notes: e.notes },
    }));
  });

  app.post('/investigacao/:id', async (req, reply) => {
    const id = idParam(req);
    const e = id && getExam(db, id);
    if (!e || e.source !== 'investigacao') return reply.callNotFound();
    const { values, errors, data } = parse(req.body);
    if (!data) return send(reply, req, form(req, db, { exam: e, values, errors }), 400);
    const type = db.prepare('SELECT minutes FROM exam_types WHERE id = ?').get(data.typeId);
    const res = updateResearch(db, req.user, id, {
      code: data.code, project: data.project, typeId: data.typeId, startsAt: `${data.date}T${data.time}`,
      minutes: data.minutes === '' ? (type?.minutes || e.minutes) : data.minutes, notes: data.notes,
    });
    if (!res.ok) {
      if (res.reason === 'estado' || res.reason === 'nao_existe') return reply.redirect(`/exames/${id}?err=estado`);
      const msg = res.reason === 'tipo_com_ficha' ? 'A ficha desta avaliação já foi começada: o tipo já não pode mudar.' : slotError(db, res);
      return send(reply, req, form(req, db, { exam: e, values, errors: { [res.reason === 'tipo_com_ficha' ? 'typeId' : 'time']: msg, _: msg } }), 400);
    }
    return reply.redirect(`/exames/${id}?msg=avaliacao_alterada`);
  });
}
