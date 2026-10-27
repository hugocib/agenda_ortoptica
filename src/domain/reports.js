// Modelos de relatório por tipo de exame.
// O texto é gerado de forma determinística a partir dos valores introduzidos: não há texto
// inventado. Os normativos são os do laboratório (Administração → Normativos); sem normativo
// definido, o valor aparece sem classificação. A conclusão é sempre escrita/revista à mão.
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

export const TEMPLATES = {
  erg: {
    title: 'Eletrorretinograma de campo total',
    technique: [
      sel('eletrodos', 'Elétrodos', ['DTL', 'HK-loop', 'lentes de contacto', 'cutâneos']),
      one(txt('midriase', 'Midríase (fármaco)', { placeholder: 'p. ex. tropicamida 1% + fenilefrina 2,5%' })),
      one(num('adaptacao_escuro', 'Adaptação ao escuro', 'min')),
      COOP,
    ],
    techniqueText: (d) =>
      `Exame realizado segundo o padrão ISCEV para ERG de campo total${d.eletrodos ? `, com elétrodos ${d.eletrodos}` : ''}` +
      `${d.midriase ? `, após midríase farmacológica (${d.midriase})` : ''}` +
      `${d.adaptacao_escuro ? ` e ${fmtNum(d.adaptacao_escuro)} min de adaptação ao escuro` : ''}.` +
      `${d.cooperacao ? ` Colaboração ${d.cooperacao}.` : ''}`,
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
    techniqueText: (d) =>
      `${d.modalidade || 'ERG'} realizado segundo o padrão ISCEV${d.eletrodos ? `, com elétrodos ${d.eletrodos}` : ''}, com correção ótica para a distância do estímulo.` +
      `${d.cooperacao ? ` Colaboração ${d.cooperacao}.` : ''}`,
    sections: [
      { title: 'PERG', fields: [num('p50_amp', 'P50 — amplitude', 'µV'), num('p50_lat', 'P50 — latência', 'ms'), num('n95_amp', 'N95 — amplitude', 'µV'), num('n95_p50', 'Razão N95/P50', '')] },
      { title: 'mfERG — densidade de resposta por anel', fields: [1, 2, 3, 4, 5].map((r) => num(`mf_r${r}`, `Anel ${r}`, 'nV/deg²')) },
    ],
  },
  pev: {
    title: 'Potenciais evocados visuais',
    technique: [sel('estimulo', 'Estímulo', ['pattern reversal', 'pattern onset', 'flash', 'pattern reversal e flash']), one(txt('correcao', 'Correção ótica usada')), COOP],
    techniqueText: (d) =>
      `PEV realizado segundo o padrão ISCEV${d.estimulo ? `, com estímulo ${d.estimulo}` : ''}, estimulação monocular` +
      `${d.correcao ? ` e correção ótica (${d.correcao})` : ''}.${d.cooperacao ? ` Colaboração ${d.cooperacao}.` : ''}`,
    sections: [
      { title: 'Pattern reversal — xadrez 60′ (1°)', fields: [num('pr60_p100_lat', 'P100 — latência', 'ms'), num('pr60_p100_amp', 'N75–P100 — amplitude', 'µV')] },
      { title: 'Pattern reversal — xadrez 15′ (0,25°)', fields: [num('pr15_p100_lat', 'P100 — latência', 'ms'), num('pr15_p100_amp', 'N75–P100 — amplitude', 'µV')] },
      { title: 'Flash', fields: [num('fl_p2_lat', 'P2 — latência', 'ms'), num('fl_p2_amp', 'P2 — amplitude', 'µV')] },
    ],
  },
  eog: {
    title: 'Eletro-oculograma',
    technique: [one(num('fase_escuro', 'Fase de escuro', 'min')), one(num('fase_luz', 'Fase de luz', 'min')), COOP],
    techniqueText: (d) =>
      `EOG realizado segundo o padrão ISCEV, com sacadas de amplitude fixa` +
      `${d.fase_escuro ? `, ${fmtNum(d.fase_escuro)} min em escuro` : ''}${d.fase_luz ? ` e ${fmtNum(d.fase_luz)} min em luz` : ''}.` +
      `${d.cooperacao ? ` Colaboração ${d.cooperacao}.` : ''}`,
    sections: [
      { title: 'Resultados', fields: [num('dark_trough', 'Vale de escuro', 'µV'), num('light_peak', 'Pico de luz', 'µV'), num('light_peak_t', 'Tempo até ao pico de luz', 'min'), num('arden', 'Razão de Arden', '')] },
    ],
  },
  oct: {
    title: 'Tomografia de coerência ótica',
    technique: [sel('protocolo', 'Protocolo', ['Macular Cube 512×128', 'Optic Disc Cube 200×200', 'HD 5 Line Raster', 'Anterior Segment']), one(txt('equipamento', 'Equipamento', { default: 'Zeiss Cirrus 5000 HD-OCT' }))],
    techniqueText: (d) => `OCT realizado em ${d.equipamento || 'Zeiss Cirrus 5000 HD-OCT'}${d.protocolo ? `, protocolo ${d.protocolo}` : ''}.`,
    sections: [
      { title: 'Medições', fields: [num('ssi', 'Intensidade do sinal', '/10'), num('cst', 'Espessura do subcampo central', 'µm'), num('vol', 'Volume do cubo', 'mm³'), num('rnfl', 'CFNR — espessura média', 'µm'), num('gcipl', 'CCG+CPI — espessura média', 'µm')] },
      { title: 'Observações', fields: [txt('obs', 'Achados qualitativos', { wide: true })] },
    ],
  },
  microperimetria: {
    title: 'Microperimetria',
    technique: [sel('grelha', 'Grelha', ['10-2', 'Macula 20°', 'personalizada']), sel('estrategia', 'Estratégia', ['4-2', '4-2-1', 'rápida']), COOP],
    techniqueText: (d) =>
      `Microperimetria realizada em Nidek MP-3S${d.grelha ? `, grelha ${d.grelha}` : ''}${d.estrategia ? `, estratégia ${d.estrategia}` : ''}, com seguimento automático da fixação.` +
      `${d.cooperacao ? ` Colaboração ${d.cooperacao}.` : ''}`,
    sections: [
      { title: 'Resultados', fields: [num('sens_media', 'Sensibilidade média', 'dB'), num('fix_p1', 'Fixação P1 (2°)', '%'), num('fix_p2', 'Fixação P2 (4°)', '%'), num('bcea95', 'BCEA 95%', 'deg²'), txt('padrao', 'Padrão / localização dos defeitos', { wide: true })] },
    ],
  },
  metropsis: {
    title: 'Sensibilidade ao contraste e visão cromática (Metropsis)',
    technique: [sel('teste', 'Teste', ['acromático', 'cromático', 'acromático e cromático']), sel('visao', 'Condição', ['monocular', 'binocular']), one(txt('correcao', 'Correção ótica usada')), COOP],
    techniqueText: (d) =>
      `Avaliação psicofísica em Cambridge Research Systems Metropsis${d.teste ? `, teste ${d.teste}` : ''}${d.visao ? `, em visão ${d.visao}` : ''}` +
      `${d.correcao ? `, com correção ótica (${d.correcao})` : ''}.${d.cooperacao ? ` Colaboração ${d.cooperacao}.` : ''}`,
    sections: [
      { title: 'Sensibilidade ao contraste', fields: [num('aulcsf', 'Área sob a curva (AULCSF)', 'log'), num('pico', 'Sensibilidade máxima', 'log CS'), num('corte', 'Frequência de corte', 'c/grau')] },
      { title: 'Visão cromática (limiares)', fields: [num('protan', 'Protan', 'u. equip.'), num('deutan', 'Deutan', 'u. equip.'), num('tritan', 'Tritan', 'u. equip.')] },
    ],
  },
  ortoptica: {
    title: 'Avaliação ortóptica',
    technique: [],
    techniqueText: () => '',
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
    techniqueText: () => '',
    sections: [
      { title: 'Refração', fields: [txt('refr_obj', 'Refração objetiva'), txt('refr_subj', 'Refração subjetiva'), txt('av_cc', 'AV com correção')] },
      { title: 'Correção no scanner', fields: [one(txt('lentes_rm', 'Lentes compatíveis com RM usadas', { wide: true })), one(txt('projeto', 'Projeto / protocolo'))] },
    ],
  },
  retinografia: {
    title: 'Retinografia',
    technique: [sel('campos', 'Campos', ['1 campo (polo posterior)', '2 campos', '7 campos', 'panorâmica']), sel('qualidade', 'Qualidade da imagem', ['boa', 'aceitável', 'insuficiente'])],
    techniqueText: (d) => `Retinografia a cores${d.campos ? `, ${d.campos}` : ''}.${d.qualidade ? ` Qualidade da imagem ${d.qualidade}.` : ''}`,
    sections: [{ title: 'Descrição', fields: [txt('achados', 'Achados', { wide: true })] }],
  },
  eyetracking: {
    title: 'Avaliação oculomotora por eye-tracking',
    technique: [one(txt('protocolo', 'Protocolo', { default: 'GazeLab (BCN Innova)' })), COOP],
    techniqueText: (d) => `Registo oculomotor com ${d.protocolo || 'GazeLab (BCN Innova)'}.${d.cooperacao ? ` Colaboração ${d.cooperacao}.` : ''}`,
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
    techniqueText: (d) => (d.procedimentos ? `Procedimentos: ${d.procedimentos}.` : ''),
    sections: [{ title: 'Resultados', fields: [one(area('resultados', 'Resultados'))] }],
  },
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATES);

export function getTemplate(key) {
  return TEMPLATES[key] || TEMPLATES.generico;
}

export function allFields(tpl) {
  return [...tpl.technique, ...tpl.sections.flatMap((s) => s.fields)];
}

export function numericFields(tpl) {
  return tpl.sections.flatMap((s) => s.fields.filter((f) => f.type === 'number').map((f) => ({ ...f, section: s.title })));
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

const MAX_TEXT = 2000;

/** Lê os campos do formulário do relatório. Devolve { data, errors, raw }. */
export function parseReportForm(tpl, body) {
  const data = {};
  const errors = {};
  const rawValues = {};
  for (const f of allFields(tpl)) {
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

/** Compara com os normativos do laboratório. norms: { 'erg.da3_b_amp': {min, max} } */
export function evaluate(templateKey, data, norms) {
  const tpl = getTemplate(templateKey);
  const findings = [];
  let checked = 0;
  for (const f of numericFields(tpl)) {
    const n = norms?.[`${templateKey}.${f.key}`];
    const vals = f.eyes ? [['OD', data[f.key]?.OD], ['OE', data[f.key]?.OE]] : [[null, data[f.key]]];
    for (const [eye, v] of vals) {
      if (typeof v !== 'number') continue;
      if (!n || (n.min == null && n.max == null)) continue;
      checked++;
      if (n.min != null && v < n.min) findings.push({ field: f, eye, value: v, dir: 'abaixo', limit: n.min });
      else if (n.max != null && v > n.max) findings.push({ field: f, eye, value: v, dir: 'acima', limit: n.max });
    }
  }
  return { findings, checked };
}

export function flagFor(templateKey, f, v, norms) {
  const n = norms?.[`${templateKey}.${f.key}`];
  if (typeof v !== 'number' || !n) return '';
  if (n.min != null && v < n.min) return '↓';
  if (n.max != null && v > n.max) return '↑';
  return '';
}

/** Texto de sugestão para a conclusão (o ortoptista revê sempre). */
export function suggestConclusion(templateKey, data, norms) {
  const { findings, checked } = evaluate(templateKey, data, norms);
  if (checked === 0) return '';
  if (findings.length === 0) return 'Parâmetros avaliados dentro dos limites normativos do laboratório.';
  const lines = findings.map((x) => {
    const unit = x.field.unit ? ` ${x.field.unit}` : '';
    return `${x.field.label}${x.eye ? ` (${x.eye})` : ''} ${x.dir} do normativo: ${fmtNum(x.value)}${unit} (limite ${fmtNum(x.limit)}${unit}).`;
  });
  return `Valores fora dos limites normativos do laboratório:\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

function valueCell(v) {
  if (v === undefined || v === null || v === '') return html`<td class="v empty">—</td>`;
  return html`<td class="v">${fmtNum(v)}</td>`;
}

/**
 * HTML do relatório (fragmento). Usado na pré-visualização e guardado tal como está ao validar.
 * ctx: { templateKey, data, conclusion, exam, request, examType, settings, signedBy, validatedAt }
 */
export function renderReport(ctx) {
  const { templateKey, data, conclusion, exam, request, examType, settings } = ctx;
  const tpl = getTemplate(templateKey);
  const norms = settings.norms || {};
  const age = ageAt(request.birth_date, exam.starts_at);
  const techniqueText = tpl.techniqueText(data);
  const { findings } = evaluate(templateKey, data, norms);

  const sections = tpl.sections.map((s) => {
    const filled = s.fields.filter((f) => (f.eyes ? data[f.key]?.OD !== undefined || data[f.key]?.OE !== undefined : data[f.key] !== undefined));
    if (!filled.length) return '';
    const bilateral = filled.some((f) => f.eyes);
    const rows = filled.map((f) => {
      const unit = f.unit || '';
      if (f.eyes) {
        const od = data[f.key]?.OD;
        const oe = data[f.key]?.OE;
        return html`<tr><th scope="row">${f.label}</th>${valueCell(od)}<td class="flag">${flagFor(templateKey, f, od, norms)}</td>${valueCell(oe)}<td class="flag">${flagFor(templateKey, f, oe, norms)}</td><td class="u">${unit}</td></tr>`;
      }
      const v = data[f.key];
      if (bilateral) {
        return html`<tr><th scope="row">${f.label}</th><td class="v" colspan="4">${fmtNum(v)}${flagFor(templateKey, f, v, norms) ? html` <span class="flag">${flagFor(templateKey, f, v, norms)}</span>` : ''}</td><td class="u">${unit}</td></tr>`;
      }
      return html`<tr><th scope="row">${f.label}</th><td class="v">${fmtNum(v)}${flagFor(templateKey, f, v, norms) ? html` <span class="flag">${flagFor(templateKey, f, v, norms)}</span>` : ''}</td><td class="u">${unit}</td></tr>`;
    });
    const head = bilateral
      ? html`<thead><tr><th class="lbl"></th><th class="v">OD</th><th class="flag"></th><th class="v">OE</th><th class="flag"></th><th class="u"></th></tr></thead>`
      : '';
    return html`<section class="r-section"><h3>${s.title}</h3><table class="r-table">${head}<tbody>${rows}</tbody></table></section>`;
  });

  const header = (settings.report_header || []).map((l) => html`<div>${l}</div>`);
  const hasNorms = Object.keys(norms).some((k) => k.startsWith(`${templateKey}.`));

  return html`<article class="report">
  <header class="r-header">${header}</header>
  <h1 class="r-title">${tpl.title}</h1>
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
    ${hasNorms ? html`<p class="r-note">↓ / ↑ abaixo / acima dos limites normativos do laboratório.${findings.length ? '' : ' Sem valores fora dos limites.'}</p>` : ''}
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
