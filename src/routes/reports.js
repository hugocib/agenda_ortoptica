import { html, raw } from '../html.js';
import { audit, getSetting } from '../db.js';
import { getExam } from '../repo.js';
import { ageText, fmtNum, normFor, normText, parseReportForm, renderReport, suggestConclusion, usableForm } from '../domain/reports.js';
import { ageAt, fmtDate } from '../time.js';
import { flash, icon, pageHead, patientLabel } from '../ui.js';
import { forbid, idParam, isOrtho, send, str } from './util.js';

function reportSettings(db) {
  return {
    report_header: getSetting(db, 'report_header'),
    report_signer: getSetting(db, 'report_signer'),
    report_signer_id: getSetting(db, 'report_signer_id'),
    report_medical_line: getSetting(db, 'report_medical_line'),
    report_logo: getSetting(db, 'report_logo'),
  };
}

function loadReport(db, examId) {
  return db.prepare('SELECT * FROM reports WHERE exam_id = ?').get(examId);
}

function input(f, name, value, error, norm = null) {
  const v = value ?? '';
  if (f.type === 'select') {
    return html`<select name="${name}" id="${name}"><option value="">—</option>${f.options.map((o) => html`<option${o === v ? html` selected` : ''}>${o}</option>`)}</select>`;
  }
  if (f.type === 'textarea') return html`<textarea name="${name}" id="${name}" rows="4">${v}</textarea>`;
  const isNum = f.type === 'number';
  return html`<input name="${name}" id="${name}" value="${typeof v === 'number' ? fmtNum(v) : v}"${isNum ? html` inputmode="decimal" class="num${error ? ' invalid' : ''}"${norm?.min != null ? html` data-min="${norm.min}"` : ''}${norm?.max != null ? html` data-max="${norm.max}"` : ''}` : html` class="${f.wide ? 'wide' : ''}"`}${f.placeholder ? html` placeholder="${f.placeholder}"` : ''}${error ? html` aria-invalid="true" title="${error}"` : ''}>`;
}

/** Ficha do ato e idade do doente no dia do exame (decide que normativo se aplica). */
function formCtx(exam) {
  return { form: usableForm(exam.type_form), age: ageAt(exam.birth_date, exam.starts_at) };
}

function reportForm(req, { exam, data, rawValues = null, errors = {}, conclusion, suggestion }) {
  const { form: tpl, age } = formCtx(exam);
  const val = (name, fallback) => (rawValues ? rawValues[name] : fallback);
  const technique = tpl.technique.fields.map((f) => {
    const name = `f.${f.key}`;
    return html`<label>${f.label}${f.unit ? html` <span class="muted">(${f.unit})</span>` : ''}${input(f, name, val(name, data[f.key] ?? f.default), errors[name])}</label>`;
  });
  const sections = tpl.sections.map((s) => {
    const bilateral = s.fields.some((f) => f.eyes);
    const rows = s.fields.map((f) => {
      const n = f.type === 'number' ? normFor(f, age) : null;
      const norm = n ? html`${normText(n)}${ageText(n) ? html`<small>${ageText(n)}</small>` : ''}` : '';
      const cell = (name, eye, v) => html`<span class="cell${eye ? ` ${eye}` : ''}">${input(f, name, v, errors[name], n)}${f.type === 'number' ? html`<output class="nflag" for="${name}" aria-live="polite"></output>` : ''}</span>`;
      if (f.eyes) {
        const od = `f.${f.key}.OD`;
        const oe = `f.${f.key}.OE`;
        return html`<tr><th scope="row"><label for="${od}">${f.label}</label></th>
          <td>${cell(od, 'od', val(od, data[f.key]?.OD))}</td>
          <td>${cell(oe, 'oe', val(oe, data[f.key]?.OE))}</td>
          <td class="u">${f.unit || ''}</td><td class="norm">${norm}</td></tr>`;
      }
      const name = `f.${f.key}`;
      return html`<tr><th scope="row"><label for="${name}">${f.label}</label></th>
        <td colspan="${bilateral ? 2 : 1}">${cell(name, '', val(name, data[f.key] ?? f.default))}</td>
        <td class="u">${f.unit || ''}</td><td class="norm">${norm}</td></tr>`;
    });
    return html`<fieldset class="r-fieldset"><legend>${s.title}</legend><div class="scroll-x"><table class="entry">
      ${bilateral ? html`<thead><tr><th></th><th class="eye od"><span>OD</span></th><th class="eye oe"><span>OE</span></th><th></th><th class="norm">Normativo</th></tr></thead>` : ''}
      <tbody>${rows}</tbody></table></div></fieldset>`;
  });

  return html`<form method="post" action="/exames/${exam.id}/relatorio" class="sheet report-form guarded" novalidate>
    ${Object.keys(errors).length ? html`<div class="notice err" role="alert">Há valores inválidos (assinalados a vermelho). Use números, com vírgula ou ponto decimal.</div>` : ''}
    ${exam.source !== 'investigacao' ? html`<div class="clin-info">${exam.clinical_info
      ? html`<span class="lead">Informação clínica</span> <span>${exam.clinical_info}</span>`
      : html`<span class="muted">Sem informação clínica do requisitante.</span>`} <a href="/exames/${exam.id}#dados">${exam.clinical_info ? 'alterar' : 'indicar'}</a></div>` : ''}
    ${tpl.technique.fields.length ? html`<fieldset class="r-fieldset"><legend>Técnica</legend><div class="grid3">${technique}</div></fieldset>` : ''}
    ${sections}
    <fieldset class="r-fieldset"><legend>Conclusão</legend>
      ${suggestion ? html`<p class="hint">Sugestão gerada a partir dos normativos do laboratório${age === null ? '' : ` para ${age} anos`}. Reveja-a antes de validar.</p>` : ''}
      ${age === null && numericNormsByAge(tpl) ? (exam.source === 'investigacao'
        ? html`<p class="hint">Participante identificado só por código: os normativos que dependem da idade não se aplicam.</p>`
        : html`<p class="hint">Sem data de nascimento: os normativos que dependem da idade não se aplicam. <a href="/exames/${exam.id}">Identificar o doente</a></p>`) : ''}
      <textarea name="conclusion" rows="5" maxlength="4000">${conclusion}</textarea>
    </fieldset>
    <div class="form-actions sticky">
      <button class="btn" type="submit" name="acao" value="guardar">Guardar rascunho</button>
      <button class="btn ghost" type="submit" name="acao" value="preview">Pré-visualizar</button>
      <span class="spacer"></span>
      <button class="btn primary" type="submit" name="acao" value="validar" data-confirm="Validar o relatório? Fica fixo; para alterar, terá de o reabrir.">Validar</button>
    </div>
  </form>`;
}

const numericNormsByAge = (form) => form.sections.some((s) => s.fields.some((f) => f.norms.some((n) => n.ageMin != null || n.ageMax != null)));

export default async function reportRoutes(app, { db }) {
  const guard = (req, reply) => {
    if (!isOrtho(req)) { forbid(reply); return null; }
    const id = idParam(req);
    const exam = id && getExam(db, id);
    if (!exam) { reply.callNotFound(); return null; }
    return exam;
  };

  app.get('/exames/:id/relatorio', async (req, reply) => {
    const exam = guard(req, reply);
    if (!exam) return reply;
    if (exam.status !== 'realizado') return reply.redirect(`/exames/${exam.id}?err=relatorio_estado`);
    const rep = loadReport(db, exam.id);
    const settings = reportSettings(db);
    const head = html`${pageHead(html`Relatório · ${exam.type_name}`, { back: { href: `/exames/${exam.id}`, label: 'Exame' }, sub: html`${patientLabel(exam)}<span class="when">${fmtDate(exam.starts_at)}</span>${rep?.status === 'validado' ? html`<span class="track-wrap tone-done"><span class="track-label">Validado</span></span>` : rep ? html`<span class="track-wrap tone-pending"><span class="track-label">Rascunho</span></span>` : ''}`,
        actions: rep?.status === 'validado' ? html`<a class="btn primary" href="/exames/${exam.id}/relatorio/imprimir">${icon('imprimir', 'ico sm')}Imprimir / PDF</a>
          <form method="post" action="/exames/${exam.id}/relatorio/reabrir" class="inline"><button class="btn" data-confirm="Reabrir o relatório validado? A versão atual fica guardada no histórico.">Reabrir para corrigir</button></form>` : '' })}
      ${flash(req.query, req)}`;

    if (rep?.status === 'validado') {
      return send(reply, req, {
        title: 'Relatório', active: 'hoje',
        body: html`${head}
          <div class="report-preview">${raw(rep.final_html)}</div>`,
      });
    }
    const data = rep ? JSON.parse(rep.data) : {};
    let conclusion = rep?.conclusion || '';
    const { form, age } = formCtx(exam);
    const suggestion = !conclusion ? suggestConclusion(form, data, age) : '';
    if (!conclusion) conclusion = suggestion;
    return send(reply, req, {
      title: 'Relatório', active: 'hoje',
      body: html`${head}${reportForm(req, { exam, data, conclusion, suggestion })}`,
    });
  });

  app.post('/exames/:id/relatorio', async (req, reply) => {
    const exam = guard(req, reply);
    if (!exam) return reply;
    if (exam.status !== 'realizado') return reply.redirect(`/exames/${exam.id}?err=relatorio_estado`);
    const existing = loadReport(db, exam.id);
    if (existing?.status === 'validado') return reply.redirect(`/exames/${exam.id}/relatorio?err=estado`);
    const tplKey = exam.type_code;
    const { form: tpl } = formCtx(exam);
    const settings = reportSettings(db);
    const body = req.body || {};
    const { data, errors, raw: rawValues } = parseReportForm(tpl, body);
    const conclusion = str(body.conclusion).trim().slice(0, 4000);
    const acao = str(body.acao);

    if (Object.keys(errors).length) {
      return send(reply, req, {
        title: 'Relatório', active: 'hoje',
        body: html`${pageHead(html`Relatório · ${exam.type_name}`, { back: { href: `/exames/${exam.id}`, label: 'Exame' }, sub: patientLabel(exam) })}
          ${reportForm(req, { exam, data, rawValues, errors, conclusion })}`,
      }, 400);
    }
    if (acao === 'validar' && !exam.patient_process && !exam.patient_name) {
      return send(reply, req, {
        title: 'Relatório', active: 'hoje',
        body: html`${pageHead(html`Relatório · ${exam.type_name}`, { back: { href: `/exames/${exam.id}`, label: 'Exame' }, sub: patientLabel(exam) })}
          <div class="notice err" role="alert"><p>Identifique o doente (n.º de processo ou nome) <a href="/exames/${exam.id}">na página do exame</a> antes de validar. Nada foi validado; o que escreveu continua no formulário (pode guardar como rascunho).</p></div>
          ${reportForm(req, { exam, data, conclusion })}`,
      }, 400);
    }
    if (acao === 'validar' && !conclusion) {
      return send(reply, req, {
        title: 'Relatório', active: 'hoje',
        body: html`${pageHead(html`Relatório · ${exam.type_name}`, { back: { href: `/exames/${exam.id}`, label: 'Exame' }, sub: patientLabel(exam) })}
          <div class="notice err" role="alert">Escreva a conclusão antes de validar.</div>
          ${reportForm(req, { exam, data, conclusion })}`,
      }, 400);
    }

    db.transaction(() => {
      db.prepare(`INSERT INTO reports (exam_id, template, data, conclusion, status, updated_at)
        VALUES (?, ?, ?, ?, 'rascunho', strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        ON CONFLICT(exam_id) DO UPDATE SET data = excluded.data, conclusion = excluded.conclusion, updated_at = excluded.updated_at
        WHERE reports.status = 'rascunho'`).run(exam.id, tplKey, JSON.stringify(data), conclusion);
      if (acao === 'validar') {
        const validatedAt = new Date().toISOString();
        const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(exam.request_id);
        const examType = db.prepare('SELECT * FROM exam_types WHERE id = ?').get(exam.exam_type_id);
        const finalHtml = String(renderReport({ form: examType.form, data, conclusion, exam, request, examType, settings, signedBy: req.user.name, validatedAt }));
        db.prepare("UPDATE reports SET status = 'validado', final_html = ?, validated_at = ?, validated_by = ? WHERE exam_id = ? AND status = 'rascunho'")
          .run(finalHtml, validatedAt, req.user.id, exam.id);
        audit(db, req.user.id, 'relatorio_validado', 'exame', exam.id);
      } else {
        audit(db, req.user.id, 'relatorio_guardado', 'exame', exam.id);
      }
    }).immediate();

    if (acao === 'validar') return reply.redirect(`/exames/${exam.id}/relatorio?msg=validado`);
    if (acao === 'preview') return reply.redirect(`/exames/${exam.id}/relatorio/imprimir`);
    return reply.redirect(`/exames/${exam.id}/relatorio?msg=guardado`);
  });

  app.post('/exames/:id/relatorio/reabrir', async (req, reply) => {
    const exam = guard(req, reply);
    if (!exam) return reply;
    const rep = loadReport(db, exam.id);
    if (!rep || rep.status !== 'validado') return reply.redirect(`/exames/${exam.id}/relatorio`);
    db.transaction(() => {
      db.prepare('INSERT INTO report_history (report_id, final_html, validated_at, validated_by, reopened_by) VALUES (?, ?, ?, ?, ?)')
        .run(rep.id, rep.final_html, rep.validated_at, rep.validated_by, req.user.id);
      db.prepare("UPDATE reports SET status = 'rascunho', final_html = NULL, validated_at = NULL, validated_by = NULL WHERE id = ?").run(rep.id);
      audit(db, req.user.id, 'relatorio_reaberto', 'exame', exam.id);
    }).immediate();
    return reply.redirect(`/exames/${exam.id}/relatorio?msg=reaberto`);
  });

  app.get('/exames/:id/relatorio/imprimir', async (req, reply) => {
    const exam = guard(req, reply);
    if (!exam) return reply;
    const rep = loadReport(db, exam.id);
    if (!rep) return reply.redirect(`/exames/${exam.id}/relatorio`);
    let body;
    if (rep.status === 'validado') {
      body = raw(rep.final_html);
    } else {
      const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(exam.request_id);
      const examType = db.prepare('SELECT * FROM exam_types WHERE id = ?').get(exam.exam_type_id);
      body = renderReport({ form: examType.form, data: JSON.parse(rep.data), conclusion: rep.conclusion, exam, request, examType, settings: reportSettings(db), signedBy: req.user.name });
    }
    return send(reply, req, {
      title: 'Imprimir relatório',
      bare: true,
      body: html`<div class="print-toolbar no-print">
          <a class="btn ghost" href="/exames/${exam.id}/relatorio">${icon('esq', 'ico sm')}Voltar</a>
          ${rep.status !== 'validado' ? html`<span class="owed-txt">Rascunho — não validado</span>` : ''}
          <button class="btn primary" type="button" data-print>${icon('imprimir', 'ico sm')}Imprimir / Guardar PDF</button>
        </div>
        <div class="paper${rep.status !== 'validado' ? ' draft' : ''}">${body}</div>`,
    });
  });
}
