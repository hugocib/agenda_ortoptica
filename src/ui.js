// Estrutura das páginas e componentes partilhados.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { html, raw } from './html.js';
import { REASONS } from './domain/slots.js';
import { examTrack, ORIGIN_LABEL, STATUS_LABEL } from './domain/status.js';
import { fmtDuration, periods } from './domain/tape.js';
import { fmtDateTime, fmtDate, todayLocal } from './time.js';
import { FONTS, themeById, themesCss } from './themes.js';

// Versão dos ficheiros estáticos = hash do conteúdo. Qualquer alteração ao CSS/JS/SW/ícones muda a
// versão, o browser descarrega os ficheiros novos e o service worker limpa a cache antiga.
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
export const THEMES_CSS = themesCss();
export const ASSET_VERSION = crypto.createHash('sha256')
  .update(['app.css', 'app.js', 'sw.js', 'icons.svg'].map((f) => fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8')).join('\n') + THEMES_CSS)
  .digest('hex').slice(0, 10);

function fontFile(family) {
  const f = FONTS[family];
  return (Array.isArray(f) ? f[0] : f).file;
}

// Mensagens por código: o URL nunca transporta texto livre (evita injeção e fugas de dados).
export const MESSAGES = {
  criado: 'Pedido criado.',
  agendado: 'Exame agendado. Falta marcar no Siima.',
  reagendado: 'Hora alterada.',
  reagendado_siima: 'Hora alterada. Volte a marcar no Siima.',
  confirmado: 'Reserva confirmada.',
  recusado: 'Reserva recusada.',
  alteracao_aceite: 'Alteração aceite.',
  cancelamento_aceite: 'Cancelamento aceite: a vaga ficou livre.',
  alteracao_recusada: 'Pedido recusado; fica como estava.',
  requisicao: 'N.º de requisição guardado.',
  doente: 'Identificação do doente guardada.',
  reservado: 'Reserva feita. Fica «por confirmar» até o ortoptista a confirmar.',
  reserva_mudada: 'Hora mudada. Continua por confirmar.',
  reserva_anulada: 'Reserva anulada. A vaga ficou livre.',
  pedido_alteracao: 'Pedido de alteração enviado. A hora nova fica reservada até o ortoptista decidir.',
  pedido_cancelamento: 'Pedido de cancelamento enviado.',
  pedido_retirado: 'Pedido retirado.',
  link: 'Novo link de reservas criado. O anterior deixou de funcionar.',
  push_teste: 'Notificação de teste enviada.',
  desmarcado: 'Marcação removida; o exame voltou a «por agendar».',
  cancelado: 'Cancelado.',
  realizado: 'Exame marcado como realizado.',
  faltou: 'Registada a falta.',
  anulado: 'Estado «realizado» anulado.',
  antecipado: 'Registado como realizado hoje. A hora que estava marcada ficou livre.',
  antecipado_siima: 'Registado como realizado hoje. A hora que estava marcada ficou livre; ajuste a marcação no Siima.',
  siima_marcado: 'Confirmado: marcado no Siima.',
  siima_registado: 'Confirmado: executado no Siima.',
  desfeito: 'Alteração desfeita.',
  guardado: 'Guardado.',
  validado: 'Relatório validado. Já pode imprimir e assinar.',
  reaberto: 'Relatório reaberto. A versão validada anterior ficou no histórico.',
  password: 'Palavra-passe alterada.',
  bloqueio: 'Bloqueio criado.',
  bloqueio_apagado: 'Bloqueio removido.',
  utilizador: 'Utilizador criado.',
  backup: 'Cópia de segurança criada.',
  tema: 'Tema aplicado a toda a app.',
  ics: 'Novo endereço do calendário criado. O anterior deixou de funcionar.',
  tarefa: 'Tarefa criada.',
  tarefa_guardada: 'Tarefa guardada.',
  tarefa_apagada: 'Tarefa apagada.',
  tarefa_feita: 'Tarefa marcada como feita.',
  tarefas_on: 'Quadro de tarefas ligado.',
  colunas: 'Colunas guardadas.',
  tarefas_off: 'Quadro de tarefas desligado. As tarefas ficam guardadas e voltam se o ligar outra vez.',
  avaliacao: 'Avaliação de investigação registada.',
  avaliacao_alterada: 'Avaliação alterada.',
  info_clinica: 'Informação clínica guardada.',
  logo: 'Logotipo guardado. Aparece nos relatórios a partir de agora; os já validados não mudam.',
  logo_removido: 'Logotipo removido.',
};

// Ações de um clique que podem ser desfeitas logo a seguir, a partir da mensagem de confirmação.
const UNDO = {
  siima_marcado: (id) => `/exames/${id}/siima-marcado/desfazer`,
  siima_registado: (id) => `/exames/${id}/siima-registado/desfazer`,
  realizado: (id) => `/exames/${id}/anular_realizado`,
};

export const ERRORS = {
  ...REASONS,
  estado: 'Esta ação já não é possível no estado atual do exame (alguém pode tê-lo alterado). A página foi atualizada.',
  concorrencia: 'O exame foi alterado entretanto por outra pessoa. Confirme e tente de novo.',
  nao_existe: 'Não encontrado.',
  registado: 'Este exame já está executado no Siima: desfaça primeiro esse passo.',
  sem_requisicao: 'Indique o n.º de requisição para confirmar.',
  mesma_hora: 'Essa já é a hora da reserva.',
  sem_nome: 'Escolha quem está a fazer a reserva.',
  horario: 'Horário inválido: cada período precisa de início e fim, o fim depois do início, e a tarde depois da manhã.',
  link_invalido: 'Este link de reservas já não é válido. Peça o novo ao ortoptista.',
  sem_permissao: 'Sem permissão para esta ação.',
  hora_invalida: 'Hora ou data inválida.',
  dados_invalidos: 'Dados inválidos. Verifique os valores e tente de novo.',
  relatorio_estado: 'O relatório só pode ser feito para exames realizados.',
  futuro: 'Ainda não chegou o dia deste exame. Se o doente veio antes, use «Realizado hoje (antecipado)» na página do exame.',
  backup: 'Não foi possível criar a cópia de segurança. Veja os registos do servidor.',
  tipo_com_ficha: 'A ficha desta avaliação já foi começada: o tipo de avaliação já não pode mudar.',
  logo_invalido: 'O logotipo tem de ser uma imagem PNG, JPG, WebP ou SVG com até 200 KB.',
  colunas_numero: 'O quadro tem de ter entre 2 e 8 colunas.',
  colunas_nome: 'Cada coluna precisa de um nome (até 40 caracteres).',
  colunas_repetidas: 'Há colunas com o mesmo nome.',
  colunas_concluidas: 'Escolha qual é a coluna das concluídas (e não a apague).',
  colunas_destino: 'Para apagar uma coluna com tarefas, escolha para onde as passar.',
};

/** Caminho atual sem msg/err/u, para o «desfazer» voltar ao mesmo sítio. */
function cleanPath(req) {
  const [p, q = ''] = String(req?.url || '/hoje').split('?');
  const params = new URLSearchParams(q);
  for (const k of ['msg', 'err', 'u']) params.delete(k);
  const s = params.toString();
  return s ? `${p}?${s}` : p;
}

export function flash(query, req = null) {
  const code = query?.msg;
  const ok = MESSAGES[code];
  const err = ERRORS[query?.err];
  const undoId = Number.parseInt(query?.u, 10);
  const undo = ok && UNDO[code] && Number.isSafeInteger(undoId) && undoId > 0
    ? html`<form method="post" action="${UNDO[code](undoId)}" class="inline"><input type="hidden" name="back" value="${cleanPath(req)}"><button type="submit" class="btn link">Desfazer</button></form>`
    : '';
  return html`${ok ? html`<div class="notice ok" role="status"><span>${ok}</span>${undo}</div>` : ''}${err ? html`<div class="notice err" role="alert">${err}</div>` : ''}`;
}

export function icon(name, cls = 'ico') {
  return html`<svg class="${cls}" aria-hidden="true" focusable="false"><use href="/static/icons.svg?v=${ASSET_VERSION}#i-${name}"></use></svg>`;
}

function count(n, kind = '') {
  return n ? html`<span class="count ${kind}">${n}</span>` : '';
}

function nav(user, counts, active) {
  if (!user) return '';
  // No telemóvel o menu vai para baixo: rótulos curtos onde o nome não cabe.
  const SHORT = { estatistica: 'Números' };
  const item = (href, label, key, ico, extra = '', cls = '') =>
    html`<a href="${href}" class="nav-i${cls}${active === key ? ' active' : ''}"${active === key ? raw(' aria-current="page"') : ''}>${icon(ico)}<span class="nav-l">${SHORT[key] ? html`<span class="nav-full">${label}</span><span class="nav-short" aria-hidden="true">${SHORT[key]}</span>` : label}</span>${extra}</a>`;
  const todayCount = (counts.porConfirmar || 0) + (counts.porRegistarSiima || 0) + (counts.relatoriosPendentes || 0) + (counts.porFechar || 0) + (counts.porMarcarSiima || 0);
  return html`<nav class="nav" aria-label="Principal">
    ${item('/hoje', 'Hoje', 'hoje', 'hoje', count(todayCount, 'owed'))}
    ${item('/agenda', 'Agenda', 'agenda', 'agenda')}
    ${item('/fluxo', 'Fluxo', 'fluxo', 'fluxo')}
    ${item('/pedidos', 'Pedidos', 'pedidos', 'pedidos', count(counts.porAgendar))}
    ${counts.tarefasOn ? item('/tarefas', 'Tarefas', 'tarefas', 'tarefas', count(counts.tarefas, 'owed')) : ''}
    ${item('/estatistica', 'Estatística', 'estatistica', 'estatistica')}
    ${item('/admin', 'Admin.', 'admin', 'admin')}
  </nav>`;
}

export const MARK = raw(`<svg class="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="7" class="mark-bg"/><path d="M4.5 16c3.4-4.6 7.3-6.9 11.5-6.9s8.1 2.3 11.5 6.9c-3.4 4.6-7.3 6.9-11.5 6.9S7.9 20.6 4.5 16z" class="mark-eye"/><circle cx="16" cy="16" r="4.2" class="mark-iris"/><circle cx="16" cy="16" r="1.7" class="mark-pupil"/></svg>`);

/** Botão claro/escuro da página de reservas (sem JS alterna pelo servidor; com JS sabe o modo do sistema). */
function modeToggle(req, mode) {
  const next = mode === 'escuro' ? 'claro' : 'escuro';
  return html`<form method="post" action="/aparencia/modo-reservas" class="mode-toggle">
    <input type="hidden" name="back" value="${String(req.url || '').split('#')[0]}">
    <button class="btn ghost" type="submit" name="modo" value="${next}" data-mode-toggle="${mode}" aria-label="${next === 'escuro' ? 'Mudar para modo escuro' : 'Mudar para modo claro'}" title="${next === 'escuro' ? 'Modo escuro' : 'Modo claro'}">
      ${icon('lua', 'ico mode-dark')}${icon('sol', 'ico mode-light')}<span class="mode-l">${next === 'escuro' ? 'Escuro' : 'Claro'}</span></button></form>`;
}

export function layout(req, { title, body, active = '', autorefresh = false, bare = false, wide = false, pub = false }) {
  const user = req.user;
  const counts = req.counts || {};
  const look = req.look || { theme: '', mode: 'auto' };
  const theme = themeById(look.theme);
  const metaLight = html`<meta name="theme-color" content="${theme.lightVars['--top-bg']}"${look.mode === 'auto' ? raw(' media="(prefers-color-scheme: light)"') : ''}>`;
  const metaDark = html`<meta name="theme-color" content="${theme.darkVars['--top-bg']}"${look.mode === 'auto' ? raw(' media="(prefers-color-scheme: dark)"') : ''}>`;
  const metas = look.mode === 'claro' ? metaLight : look.mode === 'escuro' ? metaDark : html`${metaLight}\n${metaDark}`;
  return `<!doctype html>
<html lang="pt-PT" data-theme="${theme.id}" data-mode="${look.mode}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${metas}
<meta name="color-scheme" content="${look.mode === 'claro' ? 'light' : look.mode === 'escuro' ? 'dark' : 'light dark'}">
<title>${html`${title}`} · Ortóptica</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/static/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/static/icon-192.png">
<link rel="preload" href="/static/fonts/${fontFile(theme.fonts.body)}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/temas.css?v=${ASSET_VERSION}">
<link rel="stylesheet" href="/static/app.css?v=${ASSET_VERSION}">
<script src="/static/app.js?v=${ASSET_VERSION}" defer></script>
</head>
<body${autorefresh ? ` data-autorefresh="${autorefresh === true ? 300 : autorefresh}"` : ''}${bare ? ' class="bare"' : user && !pub ? ' class="has-nav"' : ''}>
<a class="skip" href="#conteudo">Saltar para o conteúdo</a>
${bare ? '' : html`<header class="top">
  ${pub ? html`<span class="brand">${MARK}<span>Ortóptica</span><span class="brand-sub">reservas</span></span>` : html`<a class="brand" href="/hoje">${MARK}<span>Ortóptica</span></a>`}
  ${pub ? modeToggle(req, look.mode) : nav(user, counts, active)}
  ${user && !pub ? html`<div class="who"><a href="/conta" class="${active === 'conta' ? 'active' : ''}" title="A minha conta">${user.name}</a>
    <form method="post" action="/logout"><button class="btn link" type="submit">Sair</button></form></div>` : ''}
</header>`}
<div class="netbar" id="netbar" role="status" aria-live="polite" hidden></div>
<main id="conteudo" class="${bare ? 'bare-main' : `main${wide ? ' wide' : ''}`}">
${body}
</main>
</body>
</html>`;
}

/** Título da página com ações à direita. */
export function pageHead(title, { sub = '', actions = '', back = null, info = '' } = {}) {
  return html`<div class="page-head">
    <div class="page-title">${back ? html`<a class="back" href="${back.href}">${icon('esq', 'ico sm')}${back.label}</a>` : ''}<h1>${title}${info ? html` ${help(info)}` : ''}</h1>${sub ? html`<p class="sub">${sub}</p>` : ''}</div>
    ${actions ? html`<div class="page-actions">${actions}</div>` : ''}
  </div>`;
}

export function statusPill(status) {
  return html`<span class="state s-${status}">${STATUS_LABEL[status] || status}</span>`;
}

/** Origem só aparece quando não é externo (o caso normal). */
export function originTag(origin, project, source = '') {
  if (source === 'investigacao') return html`<span class="origin o-invest">Investigação${project ? html` <b>${project}</b>` : ''}</span>`;
  if (origin === 'externo') return '';
  return html`<span class="origin o-${origin}">${ORIGIN_LABEL[origin] === 'Projeto interno' ? 'Projeto' : 'Ensaio'}${project ? html` <b>${project}</b>` : ''}</span>`;
}

export function proc(v) {
  return html`<span class="proc">${v}</span>`;
}

/** Identificação numa linha: requisição do Siima, processo e nome (o que existir). */
export function patientLabel(e) {
  if (e.source === 'investigacao') return html`<span class="part" title="Código do participante"><span class="req-l">Part.</span> ${e.patient_process}</span>`;
  const req = e.requisition ? html`<span class="req" title="N.º de requisição"><span class="req-l">Req.</span> ${e.requisition}</span>` : '';
  if (!e.patient_process && !e.patient_name) {
    return html`${req}${e.source === 'secretariado' && e.status === 'realizado' ? html`<span class="unid">doente por identificar</span>` : ''}`;
  }
  return html`${req}${e.patient_process ? proc(e.patient_process) : ''}${e.patient_name ? html` <span class="pname">${e.patient_name}</span>` : ''}`;
}

/** Botão para copiar um código (processo, requisição) para escrever no Siima. Sem JS fica só o texto. */
export function copyable(value, label) {
  if (!value) return html`<span class="muted">—</span>`;
  return html`<button type="button" class="copy" data-copy="${value}" aria-label="Copiar ${label} ${value}">${value}${icon('copiar', 'ico xs')}</button>`;
}

/** Percurso compacto: cinco pontos + resumo em texto (o texto é o que conta para leitores de ecrã). */
export function track(e, { today = todayLocal(), label = true } = {}) {
  const t = examTrack(e, today);
  return html`<span class="track-wrap tone-${t.tone}"><span class="track" aria-hidden="true">${t.states.map((s) => html`<i class="${s}"></i>`)}</span>${label ? html`<span class="track-label">${t.summary}</span>` : html`<span class="sr">${t.summary}</span>`}</span>`;
}

export function when(e) {
  return e.starts_at ? fmtDateTime(e.starts_at) : '—';
}

export function ageDays(fromDate, today) {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/** Botão que faz POST (uma ação = um formulário; sem JavaScript obrigatório). */
export function postButton(action, label, { kind = '', confirm = '', back = '', name = '', value = '' } = {}) {
  return html`<form method="post" action="${action}" class="inline">${back ? html`<input type="hidden" name="back" value="${back}">` : ''}<button type="submit" class="btn ${kind}"${confirm ? html` data-confirm="${confirm}"` : ''}${name ? html` name="${name}" value="${value}"` : ''}>${label}</button></form>`;
}

export function emptyState(text, extra = '') {
  return html`<p class="empty">${text}${extra ? html` ${extra}` : ''}</p>`;
}

/**
 * Fita de um dia (agenda e «Hoje»). `row(e)` desenha o corpo de cada exame.
 * Tempo livre aparece entre exames; o que já passou fica esbatido.
 */
export function tape(t, row, { emptyText = 'Sem exames.', holdHref = null } = {}) {
  if (!t.items.length) return emptyState(emptyText);
  return html`<ol class="tape">${t.items.map((it) => {
    if (it.kind === 'gap') {
      return html`<li class="t-gap${it.past ? ' past' : ''}${it.minutes >= 60 ? ' long' : ''}"><span class="t-time"><time>${it.start}</time></span><span class="t-body">Livre · ${fmtDuration(it.minutes)} <span class="gap-end">até ${it.end}</span></span></li>`;
    }
    if (it.kind === 'block') {
      return html`<li class="t-block"><span class="t-time"><time>${it.start}</time><time class="end">${it.end}</time></span><span class="t-body"><b>Bloqueado</b> · ${it.block.reason}</span></li>`;
    }
    if (it.kind === 'hold') {
      const e = it.exam;
      return html`<li class="t-hold"><span class="t-time"><time>${it.start}</time><time class="end">${it.end}</time></span><span class="t-body"><b>Hora proposta</b> · ${holdHref ? html`<a href="${holdHref(e)}">${e.type_name}</a>` : e.type_name} <span class="muted">(agora ${fmtDate(e.starts_at).slice(0, 5)} ${e.starts_at.slice(11)}${e.change_by_name ? `, pedido de ${e.change_by_name}` : ''})</span></span></li>`;
    }
    const e = it.exam;
    return html`<li class="t-exam s-${e.status}"><span class="t-time"><time>${it.start}</time><time class="end">${it.end}</time></span>${row(e)}</li>`;
  })}</ol>`;
}

/**
 * Fita de um dia separada em períodos (manhã/tarde) segundo o horário; o almoço fica marcado.
 */
export function dayTapeByPeriod(t, windows, row, opts = {}) {
  const ps = periods(t, windows);
  if (ps.length === 1) return tape({ items: ps[0].items }, row, opts);
  return html`${ps.map((p) => {
    const free = p.items.filter((i) => i.kind === 'gap' && !i.past).reduce((a, g) => a + g.minutes, 0);
    return html`${p.pause ? html`<p class="pause"><span>Almoço</span> <span class="mono">${p.pause.start}–${p.pause.end}</span></p>` : ''}
    <div class="period"><h3 class="period-h">${p.label} <span class="mono">${p.window.start}–${p.window.end}</span>${free ? html` <span class="free">${fmtDuration(free)} livre</span>` : ''}</h3>
    ${p.items.length ? tape({ items: p.items }, row, opts) : html`<p class="empty">Sem nada marcado.</p>`}</div>`;
  })}`;
}

/** Linha de exame reutilizada em listas e na fita. */
export function examLine(e, { actions = '', today = todayLocal(), when: showWhen = false, trackOn = true, href = `/exames/${e.id}` } = {}) {
  return html`<div class="ex">
    <div class="ex-main">
      ${showWhen && e.starts_at ? html`<span class="when">${fmtDate(e.starts_at).slice(0, 5)} ${e.starts_at.slice(11)}</span> ` : ''}<a class="ex-title" href="${href}">${e.type_name}</a>
      <div class="ex-meta">${patientLabel(e)}${originTag(e.origin, e.project, e.source)}${e.source === 'secretariado' && e.booked_by_name ? html`<span class="by">por ${e.booked_by_name}</span>` : ''}${e.priority === 'urgente' && e.status === 'por_agendar' ? html`<span class="urgent">Urgente</span>` : ''}</div>
      ${trackOn ? html`<div class="ex-state">${track(e, { today })}</div>` : ''}
    </div>
    ${actions ? html`<div class="ex-actions">${actions}</div>` : ''}
  </div>`;
}

/**
 * Ajuda discreta: um «?» que mostra o texto ao passar o rato ou ao tocar (sem JavaScript:
 * <details>). Substitui as notas longas que ocupavam espaço permanente.
 */
export function help(content, label = 'Ajuda') {
  return html`<details class="help"><summary aria-label="${label}" title="${label}"><span aria-hidden="true">?</span></summary><div class="help-body" role="note">${content}</div></details>`;
}

/** Hora sempre em 24 h (os campos type="time" mostram AM/PM conforme a língua do browser). */
export function timeSelect(name, value, { from = '07:00', to = '21:00', step = 15, empty = '—', label = '' } = {}) {
  const opts = [];
  for (let m = toMinLocal(from); m <= toMinLocal(to); m += step) opts.push(fromMinLocal(m));
  if (value && !opts.includes(value)) { opts.push(value); opts.sort(); }
  return html`<select name="${name}" class="time-sel"${label ? html` aria-label="${label}"` : ''}>${empty !== null ? html`<option value="">${empty}</option>` : ''}${opts.map((t) => html`<option${t === value ? raw(' selected') : ''}>${t}</option>`)}</select>`;
}
const toMinLocal = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMinLocal = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Hora escrita (24 h, «hh:mm»): mais rápido do que escolher numa lista longa. O servidor normaliza com normTime. */
export function timeInput(name, value, { label = '', invalid = false, required = false } = {}) {
  return html`<input name="${name}" value="${value || ''}" class="time-in" inputmode="numeric" maxlength="5" placeholder="hh:mm" autocomplete="off" data-time${required ? raw(' required') : ''}${invalid ? raw(' aria-invalid="true"') : ''}${label ? html` aria-label="${label}"` : ''}>`;
}

/**
 * Data sempre em dd/mm/aaaa: o campo nativo type="date" mostra mm/dd/aaaa num browser em inglês.
 * O servidor aceita dd/mm/aaaa (e ISO) e converte com toIsoDate.
 */
export function dateInput(name, iso, { required = false, invalid = false, label = '' } = {}) {
  const v = iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : (iso || '');
  return html`<input name="${name}" value="${v}" class="date-in" inputmode="numeric" maxlength="10" placeholder="dd/mm/aaaa" autocomplete="off" data-date${required ? raw(' required') : ''}${invalid ? raw(' aria-invalid="true"') : ''}${label ? html` aria-label="${label}"` : ''}>`;
}

/** «terça, 27 de outubro» → «Terça, 27 de outubro» */
export function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

export function fmtD(d) { return fmtDate(d); }
