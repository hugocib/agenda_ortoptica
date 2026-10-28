// Editor da ficha de relatório de um ato/MCDT: secções, parâmetros, frase de técnica e normativos
// por idade. É um único formulário: cada botão (acrescentar, mover, apagar) guarda tudo o que já
// foi escrito e aplica a operação, por isso nunca se perde trabalho e não depende de JavaScript.
import crypto from 'node:crypto';
import { html, raw } from '../html.js';
import { audit } from '../db.js';
import { FIELD_TYPES, fmtNum, parseForm, parseNumber, techniqueSentence, unknownMarkers } from '../domain/reports.js';
import { flash, help, pageHead } from '../ui.js';
import { idParam, send, str } from './util.js';

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'campo';
const newKey = () => `n_${crypto.randomBytes(3).toString('hex')}`;
const blankField = (type = 'number') => ({ key: newKey(), label: '', unit: '', type, eyes: type === 'number', options: [], default: '', placeholder: '', wide: false, norms: [] });

/** Reconstrói a ficha a partir do formulário. Devolve { form, errors }. */
export function formFromBody(body, previous) {
  const errors = [];
  let hard = false; // erros que perdem dados (números inválidos): bloqueiam qualquer operação
  const bad = (msg) => { errors.push(msg); hard = true; };
  const get = (k) => str(body[k]);
  const idx = (re) => [...new Set(Object.keys(body).map((k) => k.match(re)?.[1]).filter((x) => x !== undefined))].map(Number).sort((a, b) => a - b);
  const prevByKey = Object.fromEntries([...previous.technique.fields, ...previous.sections.flatMap((s) => s.fields)].map((f) => [f.key, f]));

  const readField = (p, where) => {
    const key = get(`${p}.key`) || newKey();
    const prev = prevByKey[key] || {};
    const type = FIELD_TYPES[get(`${p}.type`)] ? get(`${p}.type`) : 'text';
    const label = get(`${p}.label`).trim().slice(0, 120);
    const f = {
      key, label, unit: get(`${p}.unit`).trim().slice(0, 20), type,
      eyes: get(`${p}.eyes`) === '1',
      options: get(`${p}.options`).split(/\r?\n/).map((o) => o.trim()).filter(Boolean).slice(0, 30),
      default: get(`${p}.default`).trim().slice(0, 200),
      placeholder: prev.placeholder || '', wide: prev.wide || false, norms: [],
    };
    if (!label) errors.push(`${where}: falta o nome de um parâmetro.`);
    if (type === 'select' && !f.options.length) errors.push(`${where} — ${label || 'parâmetro'}: indique as opções (uma por linha).`);
    if (type === 'number') {
      for (const k of idx(new RegExp(`^${p.replace(/\./g, '\\.')}\\.n\\.(\\d+)\\.`))) {
        const q = `${p}.n.${k}`;
        const vals = ['ageMin', 'ageMax', 'min', 'max'].map((x) => parseNumber(get(`${q}.${x}`)));
        if (vals.some((v) => v.error)) { bad(`${label || 'Parâmetro'}: valor de normativo inválido (use números).`); continue; }
        const [ageMin, ageMax, min, max] = vals.map((v) => (v.empty ? null : v.value));
        if (min === null && max === null && ageMin === null && ageMax === null) continue;
        if ((ageMin !== null && (ageMin < 0 || ageMin > 120 || !Number.isInteger(ageMin))) || (ageMax !== null && (ageMax < 0 || ageMax > 130 || !Number.isInteger(ageMax)))) {
          bad(`${label}: as idades são anos inteiros.`);
        }
        if (ageMin !== null && ageMax !== null && ageMin >= ageMax) bad(`${label}: a idade «até» tem de ser maior do que a idade «de».`);
        if (min !== null && max !== null && min > max) bad(`${label}: o mínimo é maior do que o máximo.`);
        f.norms.push({ ageMin, ageMax, min, max });
      }
    }
    return f;
  };

  const techFields = idx(/^F\.t\.(\d+)\./).map((j) => readField(`F.t.${j}`, 'Técnica'));
  const sections = idx(/^S\.(\d+)\./).map((i) => {
    const title = get(`S.${i}.title`).trim().slice(0, 120);
    if (!title) errors.push('Falta o título de uma secção.');
    return { title, fields: idx(new RegExp(`^F\\.${i}\\.(\\d+)\\.`)).map((j) => readField(`F.${i}.${j}`, title || 'Secção')) };
  });
  const form = {
    title: get('title').trim().slice(0, 160) || previous.title,
    technique: { text: get('t.text').trim().slice(0, 1200), fields: techFields },
    sections,
  };
  // Parâmetros novos ficam com uma chave legível a partir do nome (é a que se usa nos marcadores).
  const used = new Set();
  for (const f of [...form.technique.fields, ...form.sections.flatMap((s) => s.fields)]) {
    if (f.key.startsWith('n_') && f.label) {
      let k = slug(f.label); let n = 2;
      while (used.has(k) || prevByKey[k]) k = `${slug(f.label)}_${n++}`;
      f.key = k;
    }
    if (used.has(f.key)) f.key = newKey();
    used.add(f.key);
  }
  return { form, errors, hard };
}

/** Aplica uma operação de edição (acrescentar, mover, apagar). */
export function applyOp(form, op) {
  const [kind, a, b, c] = String(op || '').split(':');
  const list = (sec) => (sec === 't' ? form.technique.fields : form.sections[Number(sec)]?.fields);
  const move = (arr, i, d) => { const j = i + d; if (arr && j >= 0 && j < arr.length) [arr[i], arr[j]] = [arr[j], arr[i]]; };
  switch (kind) {
    case 'add-sec': form.sections.push({ title: 'Nova secção', fields: [blankField()] }); break;
    case 'del-sec': form.sections.splice(Number(a), 1); break;
    case 'up-sec': move(form.sections, Number(a), -1); break;
    case 'down-sec': move(form.sections, Number(a), 1); break;
    case 'add-f': list(a)?.push(blankField(a === 't' ? 'select' : 'number')); break;
    case 'del-f': list(a)?.splice(Number(b), 1); break;
    case 'up-f': move(list(a), Number(b), -1); break;
    case 'down-f': move(list(a), Number(b), 1); break;
    case 'add-n': { const f = list(a)?.[Number(b)]; if (f) f.norms.push({ ageMin: null, ageMax: null, min: null, max: null }); break; }
    case 'del-n': { const f = list(a)?.[Number(b)]; if (f) f.norms.splice(Number(c), 1); break; }
    default: break;
  }
  return form;
}

const numVal = (v) => (v === null || v === undefined ? '' : fmtNum(v));
const opBtn = (op, label, aria, extra = '') => html`<button class="btn mini" type="submit" name="op" value="${op}" aria-label="${aria}" title="${aria}"${extra ? raw(` ${extra}`) : ''}>${label}</button>`;

function fieldRows(f, p, sec, j, n, { tech = false } = {}) {
  const typeSel = html`<select name="${p}.type" data-type aria-label="Tipo">${Object.entries(FIELD_TYPES).filter(([k]) => !tech || k !== 'textarea').map(([k, l]) => html`<option value="${k}"${f.type === k ? raw(' selected') : ''}>${l}</option>`)}</select>`;
  const bands = f.norms.length ? f.norms : [];
  return html`<tbody class="fp" data-kind="${f.type}">
    <tr>
      <td><input type="hidden" name="${p}.key" value="${f.key}"><input name="${p}.label" value="${f.label}" maxlength="120" aria-label="Nome do parâmetro" placeholder="Nome do parâmetro">${tech ? html`<code class="marker">{${f.key}}</code>` : ''}</td>
      <td><input name="${p}.unit" value="${f.unit}" maxlength="20" aria-label="Unidade" placeholder="unidade" class="unit"></td>
      <td>${typeSel}</td>
      ${tech ? html`<td><input name="${p}.default" value="${f.default}" maxlength="200" aria-label="Valor por omissão" placeholder="por omissão"></td>`
        : html`<td class="center"><input type="checkbox" name="${p}.eyes" value="1"${f.eyes ? raw(' checked') : ''} aria-label="Por olho (OD/OE)"></td>`}
      <td class="acts-col">${opBtn(`up-f:${sec}:${j}`, '↑', 'Subir')}${opBtn(`down-f:${sec}:${j}`, '↓', 'Descer')}${opBtn(`del-f:${sec}:${j}`, '✕', 'Apagar parâmetro', `data-confirm="Apagar «${f.label || 'parâmetro'}»?${n ? ` ${n} relatório(s) em rascunho perdem este valor.` : ''}"`)}</td>
    </tr>
    <tr class="sub show-select"><td colspan="5"><label>Opções <span class="opt">uma por linha</span><textarea name="${p}.options" rows="${Math.max(2, Math.min(6, f.options.length + 1))}">${f.options.join('\n')}</textarea></label></td></tr>
    ${tech ? '' : html`<tr class="sub show-number"><td colspan="5">
      <div class="bands"><span class="bands-l">Normativos ${help(html`<p>Limites do laboratório para este parâmetro. Pode ter vários intervalos por idade: aplica-se o primeiro que inclui a idade do doente no dia do exame («de» incluída, «até» excluída).</p><p>Deixe as idades vazias para «todas as idades». Sem data de nascimento, só vale um intervalo sem idades.</p>`)}</span>
      ${bands.map((b, k) => html`<span class="band">
        <label>dos<input name="${p}.n.${k}.ageMin" value="${numVal(b.ageMin)}" inputmode="numeric" class="band-age" aria-label="Idade de"></label>
        <label>aos<input name="${p}.n.${k}.ageMax" value="${numVal(b.ageMax)}" inputmode="numeric" class="band-age" aria-label="Idade até"> anos:</label>
        <label>mín.<input name="${p}.n.${k}.min" value="${numVal(b.min)}" inputmode="decimal" class="lim" aria-label="Mínimo"></label>
        <label>máx.<input name="${p}.n.${k}.max" value="${numVal(b.max)}" inputmode="decimal" class="lim" aria-label="Máximo"></label>
        ${opBtn(`del-n:${sec}:${j}:${k}`, '✕', 'Apagar intervalo')}</span>`)}
      ${opBtn(`add-n:${sec}:${j}`, bands.length ? '+ intervalo por idade' : '+ normativo', 'Acrescentar normativo', 'data-wide')}
      </div></td></tr>`}
  </tbody>`;
}

function editorPage(req, { type, form, errors = [], drafts, others }) {
  const fieldTable = (sec, fields, tech = false) => html`<table class="ficha-params">
    <thead><tr><th>Parâmetro</th><th>Unidade</th><th>Tipo</th><th>${tech ? 'Por omissão' : html`OD/OE ${help('Marque se o parâmetro se mede em cada olho (duas colunas no relatório).')}`}</th><th><span class="sr">Ações</span></th></tr></thead>
    ${fields.map((f, j) => fieldRows(f, `F.${sec}.${j}`, sec, j, drafts, { tech }))}
  </table>`;
  const sample = Object.fromEntries([...form.technique.fields, ...form.sections.flatMap((s) => s.fields)].map((f) => [f.key, `«${f.label || f.key}»`]));
  const preview = techniqueSentence(form.technique.text, sample);
  const unknown = unknownMarkers(form.technique.text, form);
  return {
    title: `Ficha · ${type.name}`,
    active: 'admin',
    wide: true,
    body: html`${pageHead(html`Ficha · ${type.name}`, {
        back: { href: '/admin/exames', label: 'Atos / MCDTs' },
        info: html`<p>A ficha define o formulário do relatório deste ato e os normativos de cada parâmetro.</p><p>Relatórios já validados nunca mudam. Os rascunhos passam a usar a ficha nova.</p>`,
      })}
      ${flash(req.query, req)}
      ${errors.length ? html`<div class="notice err" role="alert"><div><p><b>Não foi guardado.</b> Corrija:</p><ul>${errors.slice(0, 8).map((e) => html`<li>${e}</li>`)}</ul></div></div>` : ''}
      ${drafts ? html`<div class="notice warn"><p>${drafts} ${drafts === 1 ? 'relatório em rascunho usa' : 'relatórios em rascunho usam'} esta ficha. Apagar um parâmetro apaga esse valor nesses rascunhos.</p></div>` : ''}
      <form method="post" action="/admin/exames/${type.id}/ficha" class="ficha" id="ficha">
        <section class="sec"><div class="sec-h"><h2>Título do relatório</h2></div>
          <input name="title" value="${form.title}" maxlength="160" aria-label="Título do relatório" class="ficha-title">
        </section>
        <section class="sec"><div class="sec-h"><h2>Técnica</h2>${help(html`<p>Campos que descrevem como o exame foi feito (elétrodos, protocolo…) e a frase que aparece no relatório.</p><p>Na frase, <code>{chave}</code> é substituído pelo valor do campo. O que está entre <code>[ ]</code> só aparece se os campos lá dentro estiverem preenchidos.</p>`)}</div>
          ${form.technique.fields.length ? fieldTable('t', form.technique.fields, true) : ''}
          ${opBtn('add-f:t', '+ campo de técnica', 'Acrescentar campo de técnica', 'data-wide')}
          <label class="sentence">Frase no relatório
            <textarea name="t.text" rows="3" maxlength="1200" data-sentence>${form.technique.text}</textarea></label>
          ${form.technique.fields.length ? html`<p class="markers"><span class="muted small">Inserir:</span> ${form.technique.fields.map((f) => html`<button type="button" class="chip" data-insert="{${f.key}}" title="${f.label}">{${f.key}}</button>`)}</p>` : ''}
          ${unknown.length ? html`<p class="field-err">Marcadores sem campo: ${unknown.map((k) => `{${k}}`).join(', ')}. Ficam vazios no relatório.</p>` : ''}
          ${preview ? html`<p class="sentence-preview"><span class="muted small">Exemplo:</span> ${preview}</p>` : ''}
        </section>
        ${form.sections.map((s, i) => html`<section class="sec ficha-sec" id="sec-${i}">
          <div class="fs-head"><input name="S.${i}.title" value="${s.title}" maxlength="120" aria-label="Título da secção" class="sec-title">
            <span class="acts-col">${opBtn(`up-sec:${i}`, '↑', 'Subir secção')}${opBtn(`down-sec:${i}`, '↓', 'Descer secção')}${opBtn(`del-sec:${i}`, 'Apagar secção', 'Apagar secção', `data-confirm="Apagar a secção «${s.title}» e os seus parâmetros?"`)}</span></div>
          ${s.fields.length ? fieldTable(i, s.fields) : html`<p class="empty">Sem parâmetros.</p>`}
          ${opBtn(`add-f:${i}`, '+ parâmetro', 'Acrescentar parâmetro', 'data-wide')}
        </section>`)}
        <p>${opBtn('add-sec', '+ secção', 'Acrescentar secção', 'data-wide')}</p>
        <div class="form-actions sticky-bar"><button class="btn primary" type="submit" name="op" value="">Guardar ficha</button><a class="btn ghost" href="/admin/exames">Voltar</a></div>
      </form>
      ${others.length ? html`<section class="sec quiet"><div class="sec-h"><h2>Começar de outra ficha</h2>${help('Substitui esta ficha por uma cópia da ficha de outro ato (incluindo os normativos). Útil para atos parecidos.')}</div>
        <form method="post" action="/admin/exames/${type.id}/ficha/copiar" class="toolbar">
          <label>Copiar de <select name="from">${others.map((o) => html`<option value="${o.id}">${o.name}</option>`)}</select></label>
          <button class="btn" type="submit" data-confirm="Substituir a ficha de «${type.name}» por uma cópia? A ficha atual perde-se.">Copiar ficha</button>
        </form></section>` : ''}`,
  };
}

export default async function fichaRoutes(app, { db }) {
  const load = (req) => {
    const id = idParam(req);
    return id ? db.prepare('SELECT * FROM exam_types WHERE id = ?').get(id) : null;
  };
  const draftsOf = (typeId) => db.prepare(`SELECT COUNT(*) FROM reports r JOIN exams e ON e.id = r.exam_id WHERE e.exam_type_id = ? AND r.status = 'rascunho'`).pluck().get(typeId);
  const othersOf = (typeId) => db.prepare('SELECT id, name FROM exam_types WHERE id <> ? ORDER BY active DESC, sort, name').all(typeId);

  app.get('/admin/exames/:id/ficha', async (req, reply) => {
    const type = load(req);
    if (!type) return reply.callNotFound();
    return send(reply, req, editorPage(req, { type, form: parseForm(type.form), drafts: draftsOf(type.id), others: othersOf(type.id) }));
  });

  app.post('/admin/exames/:id/ficha', async (req, reply) => {
    const type = load(req);
    if (!type) return reply.callNotFound();
    const { form, errors, hard } = formFromBody(req.body || {}, parseForm(type.form));
    const op = str(req.body?.op);
    // Acrescentar/mover/apagar guarda sempre (os campos novos vêm vazios); só «Guardar» exige tudo válido.
    const structural = /^(add|del|up|down)-/.test(op);
    if (hard || (errors.length && !structural)) {
      return send(reply, req, editorPage(req, { type, form, errors, drafts: draftsOf(type.id), others: othersOf(type.id) }), 400);
    }
    applyOp(form, op);
    db.prepare('UPDATE exam_types SET form = ? WHERE id = ?').run(JSON.stringify(form), type.id);
    if (!structural) audit(db, req.user.id, 'alterar_ficha', 'tipo_exame', type.id);
    const anchor = op.match(/^(?:add-f|del-f|up-f|down-f|add-n|del-n):(\d+)/)?.[1];
    return reply.redirect(`/admin/exames/${type.id}/ficha${structural ? '' : '?msg=guardado'}${anchor !== undefined ? `#sec-${anchor}` : ''}`);
  });

  app.post('/admin/exames/:id/ficha/copiar', async (req, reply) => {
    const type = load(req);
    const from = db.prepare('SELECT * FROM exam_types WHERE id = ?').get(Number(str(req.body?.from)));
    if (!type || !from) return reply.callNotFound();
    db.prepare('UPDATE exam_types SET form = ? WHERE id = ?').run(JSON.stringify(parseForm(from.form)), type.id);
    audit(db, req.user.id, 'copiar_ficha', 'tipo_exame', type.id, { de: from.id });
    return reply.redirect(`/admin/exames/${type.id}/ficha?msg=guardado`);
  });
}
