// Fichas de relatório. Cada ato/MCDT tem a sua ficha (exam_types.form, JSON), editável em
// Administração → Atos / MCDTs → Ficha: secções, parâmetros, frase de técnica e normativos.
// Os modelos abaixo são só pontos de partida: na primeira utilização cada ato recebe uma cópia.
// O texto do relatório é gerado de forma determinística a partir dos valores introduzidos: não há
// texto inventado. Sem normativo definido, o valor aparece sem classificação. A conclusão é
// sempre escrita/revista à mão.
import { html, esc } from '../html.js';
import { ageAt, fmtDate, fmtDateTime, fmtUtcLocal } from '../time.js';
import { ORIGIN_LABEL } from './status.js';

// Construtores de campos
const num = (key, label, unit = '', opts = {}) => ({ key, label, unit, type: 'number', eyes: true, ...opts });
const txt = (key, label, opts = {}) => ({ key, label, type: 'text', eyes: true, ...opts });
const area = (key, label, opts = {}) => ({ key, label, type: 'textarea', eyes: false, ...opts });
const sel = (key, label, options, opts = {}) => ({ key, label, type: 'select', options, eyes: false, ...opts });
const one = (f) => ({ ...f, eyes: false });

const COOP = sel('cooperacao', 'Colaboração', ['boa', 'razoável', 'fraca']);

// techniqueText: frase com marcadores {campo}; o que está entre [ ] só aparece se todos os
// campos lá dentro estiverem preenchidos.
export const TEMPLATES = {
  erg: {
    title: 'Eletrorretinograma de campo total',
    technique: [
      sel('eletrodos', 'Elétrodos', ['DTL', 'HK-loop', 'lentes de contacto', 'cutâneos']),
      one(txt('midriase', 'Midríase (fármaco)', { placeholder: 'p. ex. tropicamida 1% + fenilefrina 2,5%' })),
      one(num('adaptacao_escuro', 'Adaptação ao escuro', 'min')),
      COOP,
    ],
    techniqueText: 'Exame realizado segundo o padrão ISCEV para ERG de campo total[, com elétrodos {eletrodos}][, após midríase farmacológica ({midriase})][ e {adaptacao_escuro} min de adaptação ao escuro].[ Colaboração {cooperacao}.]',
    sections: [
      { title: 'DA 0,01 — resposta de bastonetes', fields: [num('da001_b_amp', 'Onda b — amplitude', 'µV'), num('da001_b_ti', 'Onda b — tempo implícito', 'ms')] },
      { title: 'DA 3,0 — resposta mista', fields: [num('da3_a_amp', 'Onda a — amplitude', 'µV'), num('da3_a_ti', 'Onda a — tempo implícito', 'ms'), num('da3_b_amp', 'Onda b — amplitude', 'µV'), num('da3_b_ti', 'Onda b — tempo implícito', 'ms')] },
      { title: 'DA 10,0', fields: [num('da10_a_amp', 'Onda a — amplitude', 'µV'), num('da10_b_amp', 'Onda b — amplitude', 'µV')] },
      { title: 'Potenciais oscilatórios', fields: [num('ops_amp', 'Soma das amplitudes', 'µV')] },
      { title: 'LA 3,0 — resposta de cones', fields: [num('la3_a_amp', 'Onda a — amplitude', 'µV'), num('la3_b_amp', 'Onda b — amplitude', 'µV'), num('la3_b_ti', 'Onda b — tempo implícito', 'ms')] },
      { title: 'LA 30 Hz flicker', fields: [num('flk_amp', 'Amplitude', 'µV'), num('flk_ti', 'Tempo implícito', 'ms')] },
    ],
  },
  erg_pattern: {
    title: 'Eletrorretinograma pattern / multifocal',
    technique: [sel('modalidade', 'Modalidade', ['PERG', 'mfERG', 'PERG e mfERG']), sel('eletrodos', 'Elétrodos', ['DTL', 'HK-loop', 'lentes de contacto']), COOP],
    techniqueText: 'Exame realizado segundo o padrão ISCEV[ ({modalidade})][, com elétrodos {eletrodos}], com correção ótica para a distância do estímulo.[ Colaboração {cooperacao}.]',
    sections: [
      { title: 'PERG', fields: [num('p50_amp', 'P50 — amplitude', 'µV'), num('p50_lat', 'P50 — latência', 'ms'), num('n95_amp', 'N95 — amplitude', 'µV'), num('n95_p50', 'Razão N95/P50', '')] },
      { title: 'mfERG — densidade de resposta por anel', fields: [1, 2, 3, 4, 5].map((r) => num(`mf_r${r}`, `Anel ${r}`, 'nV/deg²')) },
    ],
  },
  pev: {
    title: 'Potenciais evocados visuais',
    technique: [sel('estimulo', 'Estímulo', ['pattern reversal', 'pattern onset', 'flash', 'pattern reversal e flash']), one(txt('correcao', 'Correção ótica usada')), COOP],
    techniqueText: 'PEV realizado segundo o padrão ISCEV[, com estímulo {estimulo}], estimulação monocular[ e correção ótica ({correcao})].[ Colaboração {cooperacao}.]',
    sections: [
      { title: 'Pattern reversal — xadrez 60′ (1°)', fields: [num('pr60_p100_lat', 'P100 — latência', 'ms'), num('pr60_p100_amp', 'N75–P100 — amplitude', 'µV')] },
      { title: 'Pattern reversal — xadrez 15′ (0,25°)', fields: [num('pr15_p100_lat', 'P100 — latência', 'ms'), num('pr15_p100_amp', 'N75–P100 — amplitude', 'µV')] },
      { title: 'Flash', fields: [num('fl_p2_lat', 'P2 — latência', 'ms'), num('fl_p2_amp', 'P2 — amplitude', 'µV')] },
    ],
  },
  eog: {
    title: 'Eletro-oculograma',
    technique: [one(num('fase_escuro', 'Fase de escuro', 'min')), one(num('fase_luz', 'Fase de luz', 'min')), COOP],
    techniqueText: 'EOG realizado segundo o padrão ISCEV, com sacadas de amplitude fixa[, {fase_escuro} min em escuro][ e {fase_luz} min em luz].[ Colaboração {cooperacao}.]',
    sections: [
      { title: 'Resultados', fields: [num('dark_trough', 'Vale de escuro', 'µV'), num('light_peak', 'Pico de luz', 'µV'), num('light_peak_t', 'Tempo até ao pico de luz', 'min'), num('arden', 'Razão de Arden', '')] },
    ],
  },
  oct: {
    title: 'Tomografia de coerência ótica',
    technique: [sel('protocolo', 'Protocolo', ['Macular Cube 512×128', 'Optic Disc Cube 200×200', 'HD 5 Line Raster', 'Anterior Segment']), one(txt('equipamento', 'Equipamento', { default: 'Zeiss Cirrus 5000 HD-OCT' }))],
    techniqueText: 'OCT realizado[ em {equipamento}][, protocolo {protocolo}].',
    sections: [
      { title: 'Medições', fields: [num('ssi', 'Intensidade do sinal', '/10'), num('cst', 'Espessura do subcampo central', 'µm'), num('vol', 'Volume do cubo', 'mm³'), num('rnfl', 'CFNR — espessura média', 'µm'), num('gcipl', 'CCG+CPI — espessura média', 'µm')] },
      { title: 'Observações', fields: [txt('obs', 'Achados qualitativos', { wide: true })] },
    ],
  },
  microperimetria: {
    title: 'Microperimetria',
    technique: [sel('grelha', 'Grelha', ['10-2', 'Macula 20°', 'personalizada']), sel('estrategia', 'Estratégia', ['4-2', '4-2-1', 'rápida']), COOP],
    techniqueText: 'Microperimetria realizada em Nidek MP-3S[, grelha {grelha}][, estratégia {estrategia}], com seguimento automático da fixação.[ Colaboração {cooperacao}.]',
    sections: [
      { title: 'Resultados', fields: [num('sens_media', 'Sensibilidade média', 'dB'), num('fix_p1', 'Fixação P1 (2°)', '%'), num('fix_p2', 'Fixação P2 (4°)', '%'), num('bcea95', 'BCEA 95%', 'deg²'), txt('padrao', 'Padrão / localização dos defeitos', { wide: true })] },
    ],
  },
  metropsis: {
    title: 'Sensibilidade ao contraste e visão cromática (Metropsis)',
    technique: [sel('teste', 'Teste', ['acromático', 'cromático', 'acromático e cromático']), sel('visao', 'Condição', ['monocular', 'binocular']), one(txt('correcao', 'Correção ótica usada')), COOP],
    techniqueText: 'Avaliação psicofísica em Cambridge Research Systems Metropsis[, teste {teste}][, em visão {visao}][, com correção ótica ({correcao})].[ Colaboração {cooperacao}.]',
    sections: [
      { title: 'Sensibilidade ao contraste', fields: [num('aulcsf', 'Área sob a curva (AULCSF)', 'log'), num('pico', 'Sensibilidade máxima', 'log CS'), num('corte', 'Frequência de corte', 'c/grau')] },
      { title: 'Visão cromática (limiares)', fields: [num('protan', 'Protan', 'u. equip.'), num('deutan', 'Deutan', 'u. equip.'), num('tritan', 'Tritan', 'u. equip.')] },
    ],
  },
  ortoptica: {
    title: 'Avaliação ortóptica',
    technique: [],
    techniqueText: '',
    sections: [
      { title: 'Acuidade visual e refração', fields: [txt('av_longe_sc', 'AV longe s/c'), txt('av_longe_cc', 'AV longe c/c'), txt('av_perto', 'AV perto'), txt('refracao', 'Refração', { wide: true })] },
      {
        title: 'Visão binocular e motilidade',
        fields: [
          one(txt('ct_longe', 'Cover test — longe')), one(txt('ct_perto', 'Cover test — perto')),
          one(txt('motilidade', 'Motilidade ocular', { wide: true })),
          one(num('ppc', 'Ponto próximo de convergência', 'cm')),
          one(num('estereo', 'Estereopsia (Randot)', '″ arco')),
          one(txt('worth', 'Luzes de Worth')), one(txt('vergencias', 'Vergências fusionais', { wide: true })),
          one(txt('sinoptoforo', 'Sinoptóforo', { wide: true })),
        ],
      },
    ],
  },
  refracao: {
    title: 'Refração e correção ótica para ressonância magnética funcional',
    technique: [],
    techniqueText: '',
    sections: [
      { title: 'Refração', fields: [txt('refr_obj', 'Refração objetiva'), txt('refr_subj', 'Refração subjetiva'), txt('av_cc', 'AV com correção')] },
      { title: 'Correção no scanner', fields: [one(txt('lentes_rm', 'Lentes compatíveis com RM usadas', { wide: true })), one(txt('projeto', 'Projeto / protocolo'))] },
    ],
  },
  retinografia: {
    title: 'Retinografia',
    technique: [sel('campos', 'Campos', ['1 campo (polo posterior)', '2 campos', '7 campos', 'panorâmica']), sel('qualidade', 'Qualidade da imagem', ['boa', 'aceitável', 'insuficiente'])],
    techniqueText: 'Retinografia a cores[, {campos}].[ Qualidade da imagem {qualidade}.]',
    sections: [{ title: 'Descrição', fields: [txt('achados', 'Achados', { wide: true })] }],
  },
  eyetracking: {
    title: 'Avaliação oculomotora por eye-tracking',
    technique: [one(txt('protocolo', 'Protocolo', { default: 'GazeLab (BCN Innova)' })), COOP],
    techniqueText: 'Registo oculomotor[ com {protocolo}].[ Colaboração {cooperacao}.]',
    sections: [
      {
        title: 'Resultados',
        fields: [
          one(txt('fixacao', 'Fixação', { wide: true })), one(num('sac_lat', 'Sacadas — latência', 'ms')),
          one(num('sac_ganho', 'Sacadas — ganho', '')), one(num('persec_ganho', 'Perseguição — ganho', '')),
          one(num('antisac_erro', 'Antissacadas — erros', '%')), one(txt('leitura', 'Leitura / outros testes', { wide: true })),
        ],
      },
    ],
  },
  generico: {
    title: 'Avaliação',
    technique: [one(txt('procedimentos', 'Procedimentos realizados', { wide: true }))],
    techniqueText: '[Procedimentos: {procedimentos}.]',
    sections: [{ title: 'Resultados', fields: [one(area('resultados', 'Resultados'))] }],
  },
};


export const TEMPLATE_KEYS = Object.keys(TEMPLATES);
export const FIELD_TYPES = { number: 'Número', text: 'Texto curto', textarea: 'Texto longo', select: 'Escolha' };

// ---------- Ficha (forma guardada em cada ato) ----------
// { title, technique: { text, fields: [campo] }, sections: [{ title, fields: [campo] }] }
// campo: { key, label, unit, type, eyes, options, default, placeholder, wide, norms: [{ ageMin, ageMax, min, max }] }

const cleanField = (f) => ({
  key: String(f.key), label: String(f.label || ''), unit: String(f.unit || ''),
  type: FIELD_TYPES[f.type] ? f.type : 'text', eyes: Boolean(f.eyes),
  options: Array.isArray(f.options) ? f.options.map(String) : [],
  default: f.default != null ? String(f.default) : '', placeholder: f.placeholder ? String(f.placeholder) : '', wide: Boolean(f.wide),
  norms: f.type === 'number' && Array.isArray(f.norms) ? f.norms.map((n) => ({
    ageMin: n.ageMin ?? null, ageMax: n.ageMax ?? null, min: n.min ?? null, max: n.max ?? null,
  })) : [],
});

/** Ficha a partir de um modelo de partida, com os normativos antigos (setting «norms», se houver). */
export function formFromTemplate(key, oldNorms = {}) {
  const tpl = TEMPLATES[key] || TEMPLATES.generico;
  const tplKey = TEMPLATES[key] ? key : 'generico';
  const withNorms = (f) => {
    const n = oldNorms[`${tplKey}.${f.key}`];
    return cleanField({ ...f, norms: n && (n.min != null || n.max != null) ? [{ ageMin: null, ageMax: null, min: n.min ?? null, max: n.max ?? null }] : [] });
  };
  return {
    title: tpl.title,
    technique: { text: tpl.techniqueText || '', fields: tpl.technique.map(cleanField) },
    sections: tpl.sections.map((sec) => ({ title: sec.title, fields: sec.fields.map(withNorms) })),
  };
}

/** Ficha pronta a usar num relatório: sem parâmetros por nomear (a meio da edição). */
export function usableForm(json) {
  const f = parseForm(json);
  const keep = (fs) => fs.filter((x) => x.label);
  return { ...f, technique: { ...f.technique, fields: keep(f.technique.fields) }, sections: f.sections.map((s) => ({ ...s, fields: keep(s.fields) })).filter((s) => s.fields.length) };
}

/** Lê a ficha guardada (JSON) com tolerância a campos em falta. */
export function parseForm(json) {
  let f;
  try { f = typeof json === 'string' ? JSON.parse(json) : json; } catch { f = null; }
  if (!f || typeof f !== 'object') return formFromTemplate('generico');
  return {
    title: String(f.title || 'Avaliação'),
    technique: { text: String(f.technique?.text || ''), fields: (f.technique?.fields || []).map(cleanField) },
    sections: (f.sections || []).map((s) => ({ title: String(s.title || ''), fields: (s.fields || []).map(cleanField) })),
  };
}

export function allFields(form) {
  return [...form.technique.fields, ...form.sections.flatMap((s) => s.fields)];
}

export function numericFields(form) {
  return form.sections.flatMap((s) => s.fields.filter((f) => f.type === 'number').map((f) => ({ ...f, section: s.title })));
}

export function fmtNum(n) {
  return typeof n === 'number' ? n.toLocaleString('pt-PT', { maximumFractionDigits: 3 }) : String(n ?? '');
}

// Aceita vírgula decimal ("12,5"), que é o que se escreve em Portugal.
export function parseNumber(s) {
  const t = String(s ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (t === '') return { empty: true };
  if (!/^-?\d+(\.\d+)?$/.test(t)) return { error: true };
  return { value: Number(t) };
}

/**
 * Normativo aplicável a um doente: o primeiro intervalo cuja faixa etária inclui a idade
 * (idade mínima incluída, máxima excluída). Sem idade conhecida, só vale um intervalo sem idades.
 */
export function normFor(field, age) {
  for (const n of field.norms || []) {
    if (n.min == null && n.max == null) continue;
    const anyAge = n.ageMin == null && n.ageMax == null;
    if (age == null) { if (anyAge) return n; continue; }
    if ((n.ageMin == null || age >= n.ageMin) && (n.ageMax == null || age < n.ageMax)) return n;
  }
  return null;
}

export function ageText(n) {
  if (!n || (n.ageMin == null && n.ageMax == null)) return '';
  if (n.ageMin != null && n.ageMax != null) return `${n.ageMin}–${n.ageMax} anos`;
  return n.ageMin != null ? `≥ ${n.ageMin} anos` : `< ${n.ageMax} anos`;
}

export function normText(n) {
  if (!n || (n.min == null && n.max == null)) return '';
  if (n.min != null && n.max != null) return `${fmtNum(n.min)}–${fmtNum(n.max)}`;
  return n.min != null ? `≥ ${fmtNum(n.min)}` : `≤ ${fmtNum(n.max)}`;
}

const MAX_TEXT = 2000;

/** Lê os campos do formulário do relatório. Devolve { data, errors, raw }. */
export function parseReportForm(form, body) {
  const data = {};
  const errors = {};
  const rawValues = {};
  for (const f of allFields(form)) {
    const eyes = f.eyes ? ['OD', 'OE'] : [null];
    for (const eye of eyes) {
      const name = eye ? `f.${f.key}.${eye}` : `f.${f.key}`;
      let v = body[name];
      if (Array.isArray(v)) v = v[0];
      v = typeof v === 'string' ? v : '';
      rawValues[name] = v;
      let value;
      if (f.type === 'number') {
        const p = parseNumber(v);
        if (p.error) { errors[name] = 'Número inválido'; continue; }
        if (p.empty) continue;
        value = p.value;
      } else if (f.type === 'select') {
        if (v === '') continue;
        if (!f.options.includes(v)) { errors[name] = 'Opção inválida'; continue; }
        value = v;
      } else {
        value = v.trim().slice(0, MAX_TEXT);
        if (value === '') continue;
      }
      if (eye) {
        data[f.key] = data[f.key] || {};
        data[f.key][eye] = value;
      } else {
        data[f.key] = value;
      }
    }
  }
  return { data, errors, raw: rawValues };
}

/** Compara com os normativos da ficha para a idade do doente. */
export function evaluate(form, data, age = null) {
  const findings = [];
  let checked = 0;
  for (const f of numericFields(form)) {
    const n = normFor(f, age);
    if (!n) continue;
    const vals = f.eyes ? [['OD', data[f.key]?.OD], ['OE', data[f.key]?.OE]] : [[null, data[f.key]]];
    for (const [eye, v] of vals) {
      if (typeof v !== 'number') continue;
      checked++;
      if (n.min != null && v < n.min) findings.push({ field: f, eye, value: v, dir: 'abaixo', limit: n.min });
      else if (n.max != null && v > n.max) findings.push({ field: f, eye, value: v, dir: 'acima', limit: n.max });
    }
  }
  return { findings, checked };
}

export function flagFor(f, v, age) {
  const n = normFor(f, age);
  if (typeof v !== 'number' || !n) return '';
  if (n.min != null && v < n.min) return '↓';
  if (n.max != null && v > n.max) return '↑';
  return '';
}

/** Texto de sugestão para a conclusão (o ortoptista revê sempre). */
export function suggestConclusion(form, data, age = null) {
  const { findings, checked } = evaluate(form, data, age);
  if (checked === 0) return '';
  if (findings.length === 0) return 'Parâmetros avaliados dentro dos limites normativos do laboratório.';
  const lines = findings.map((x) => {
    const unit = x.field.unit ? ` ${x.field.unit}` : '';
    return `${x.field.label}${x.eye ? ` (${x.eye})` : ''} ${x.dir} do normativo: ${fmtNum(x.value)}${unit} (limite ${fmtNum(x.limit)}${unit}).`;
  });
  return `Valores fora dos limites normativos do laboratório:\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

/**
 * Frase de técnica: {chave} é substituído pelo valor do campo; o que está entre [ ] só aparece
 * se todos os campos lá dentro tiverem valor. Devolve texto simples (o HTML escapa-o depois).
 */
export function techniqueSentence(text, data, form = null) {
  const fields = form ? Object.fromEntries(allFields(form).map((f) => [f.key, f])) : {};
  const value = (key) => {
    let v = data[key];
    if (v === undefined || v === '') v = fields[key]?.default || undefined;
    if (v === undefined || v === null || v === '') return null;
    if (typeof v === 'object') {
      const parts = ['OD', 'OE'].filter((e) => v[e] !== undefined && v[e] !== '').map((e) => `${e} ${fmtNum(v[e])}`);
      return parts.length ? parts.join(', ') : null;
    }
    return fmtNum(v);
  };
  const fill = (chunk) => {
    let missing = false;
    const outText = chunk.replace(/\{([a-z0-9_]+)\}/gi, (_, k) => { const v = value(k); if (v === null) { missing = true; return ''; } return v; });
    return { text: outText, missing };
  };
  const withOptional = String(text || '').replace(/\[([^\][]*)\]/g, (_, inner) => { const r = fill(inner); return r.missing ? '' : r.text; });
  return fill(withOptional).text.replace(/\s{2,}/g, ' ').replace(/\s+([.,;])/g, '$1').trim();
}

/** Marcadores usados na frase que não correspondem a nenhum campo da ficha. */
export function unknownMarkers(text, form) {
  const keys = new Set(allFields(form).map((f) => f.key));
  return [...new Set([...String(text || '').matchAll(/\{([a-z0-9_]+)\}/gi)].map((m) => m[1]))].filter((k) => !keys.has(k));
}

function valueCell(v) {
  if (v === undefined || v === null || v === '') return html`<td class="v empty">—</td>`;
  return html`<td class="v">${fmtNum(v)}</td>`;
}

/**
 * HTML do relatório (fragmento). Usado na pré-visualização e guardado tal como está ao validar.
 * ctx: { form, data, conclusion, exam, request, examType, settings, signedBy, validatedAt }
 */
export function renderReport(ctx) {
  const { data, conclusion, exam, request, examType, settings } = ctx;
  const form = usableForm(ctx.form);
  const age = ageAt(request.birth_date, exam.starts_at);
  const techniqueText = techniqueSentence(form.technique.text, data, form);
  const { findings, checked } = evaluate(form, data, age);

  const sections = form.sections.map((s) => {
    const filled = s.fields.filter((f) => (f.eyes ? data[f.key]?.OD !== undefined || data[f.key]?.OE !== undefined : data[f.key] !== undefined));
    if (!filled.length) return '';
    const bilateral = filled.some((f) => f.eyes);
    const rows = filled.map((f) => {
      const unit = f.unit || '';
      if (f.eyes) {
        const od = data[f.key]?.OD;
        const oe = data[f.key]?.OE;
        return html`<tr><th scope="row">${f.label}</th>${valueCell(od)}<td class="flag">${flagFor(f, od, age)}</td>${valueCell(oe)}<td class="flag">${flagFor(f, oe, age)}</td><td class="u">${unit}</td></tr>`;
      }
      const v = data[f.key];
      const flag = flagFor(f, v, age);
      if (bilateral) {
        return html`<tr><th scope="row">${f.label}</th><td class="v" colspan="4">${fmtNum(v)}${flag ? html` <span class="flag">${flag}</span>` : ''}</td><td class="u">${unit}</td></tr>`;
      }
      return html`<tr><th scope="row">${f.label}</th><td class="v">${fmtNum(v)}${flag ? html` <span class="flag">${flag}</span>` : ''}</td><td class="u">${unit}</td></tr>`;
    });
    const head = bilateral
      ? html`<thead><tr><th class="lbl"></th><th class="v">OD</th><th class="flag"></th><th class="v">OE</th><th class="flag"></th><th class="u"></th></tr></thead>`
      : '';
    return html`<section class="r-section"><h3>${s.title}</h3><table class="r-table">${head}<tbody>${rows}</tbody></table></section>`;
  });

  const header = (settings.report_header || []).map((l) => html`<div>${l}</div>`);

  return html`<article class="report">
  <header class="r-header">${header}</header>
  <h1 class="r-title">${form.title}</h1>
  <dl class="r-patient">
    ${request.patient_name ? html`<div><dt>Nome</dt><dd>${request.patient_name}</dd></div>` : ''}
    ${request.patient_process ? html`<div><dt>N.º processo</dt><dd>${request.patient_process}</dd></div>` : ''}
    ${exam.requisition ? html`<div><dt>N.º requisição</dt><dd>${exam.requisition}</dd></div>` : ''}
    ${request.birth_date ? html`<div><dt>Data de nascimento</dt><dd>${fmtDate(request.birth_date)}${age !== null ? ` (${age} anos)` : ''}</dd></div>` : ''}
    <div><dt>Data do exame</dt><dd>${fmtDateTime(exam.starts_at)}</dd></div>
    <div><dt>Exame</dt><dd>${examType.name}</dd></div>
    ${request.referrer ? html`<div><dt>Requisitante</dt><dd>${request.referrer}</dd></div>` : ''}
    ${request.origin !== 'externo' ? html`<div><dt>Origem</dt><dd>${ORIGIN_LABEL[request.origin]}${request.project ? ` — ${request.project}` : ''}</dd></div>` : ''}
  </dl>
  ${techniqueText ? html`<section class="r-section"><h2>Técnica</h2><p>${techniqueText}</p></section>` : ''}
  <section class="r-section"><h2>Resultados</h2>${sections}
    ${checked ? html`<p class="r-note">↓ / ↑ abaixo / acima dos limites normativos do laboratório${age !== null ? ` para a idade (${age} anos)` : ''}.${findings.length ? '' : ' Sem valores fora dos limites.'}</p>` : ''}
  </section>
  <section class="r-section"><h2>Conclusão</h2>${conclusion ? conclusion.split(/\n+/).map((p) => html`<p>${p}</p>`) : html`<p class="empty">—</p>`}</section>
  <footer class="r-sign">
    <div class="sig"><div class="line"></div><div>${ctx.signedBy || ''}</div><div>${settings.report_signer || ''}</div><div>${settings.report_signer_id || ''}</div></div>
    ${settings.report_medical_line ? html`<div class="sig"><div class="line"></div><div>Interpretação clínica</div><div>Médico(a)</div></div>` : ''}
  </footer>
  <p class="r-meta">${ctx.validatedAt ? `Validado em ${fmtUtcLocal(ctx.validatedAt)}` : 'Rascunho — não validado'} · Exame n.º ${exam.id}</p>
</article>`;
}

export { esc };
