// Estrutura das páginas e componentes partilhados.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { html, raw } from './html.js';
import { REASONS } from './domain/slots.js';
import { examTrack, ORIGIN_LABEL, STATIONS, STATUS_LABEL } from './domain/status.js';
import { fmtDuration } from './domain/tape.js';
import { fmtDateTime, fmtDate, todayLocal } from './time.js';

// Versão dos ficheiros estáticos = hash do conteúdo. Qualquer alteração ao CSS/JS/SW/ícones muda a
// versão, o browser descarrega os ficheiros novos e o service worker limpa a cache antiga.
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
export const ASSET_VERSION = crypto.createHash('sha256')
  .update(['app.css', 'app.js', 'sw.js', 'icons.svg'].map((f) => fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8')).join('\n'))
  .digest('hex').slice(0, 10);

// Mensagens por código: o URL nunca transporta texto livre (evita injeção e fugas de dados).
export const MESSAGES = {
  criado: 'Pedido criado.',
  agendado: 'Exame agendado. Falta marcar no Siima.',
  reagendado: 'Exame reagendado. Volte a marcar no Siima.',
  desmarcado: 'Marcação removida; o exame voltou a «por agendar».',
  cancelado: 'Cancelado.',
  realizado: 'Exame marcado como realizado.',
  faltou: 'Registada a falta.',
  anulado: 'Estado «realizado» anulado.',
  siima_marcado: 'Confirmado: marcado no Siima.',
  siima_registado: 'Confirmado: registado no Siima.',
  desfeito: 'Alteração desfeita.',
  guardado: 'Guardado.',
  validado: 'Relatório validado. Já pode imprimir e assinar.',
  reaberto: 'Relatório reaberto. A versão validada anterior ficou no histórico.',
  password: 'Palavra-passe alterada.',
  bloqueio: 'Bloqueio criado.',
  bloqueio_apagado: 'Bloqueio removido.',
  utilizador: 'Utilizador criado.',
  backup: 'Cópia de segurança criada.',
  ics: 'Novo endereço do calendário criado. O anterior deixou de funcionar.',
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
  registado: 'Este exame já está registado no Siima: desfaça primeiro o registo.',
  sem_permissao: 'Sem permissão para esta ação.',
  hora_invalida: 'Hora ou data inválida.',
  dados_invalidos: 'Dados inválidos. Verifique os valores e tente de novo.',
  relatorio_estado: 'O relatório só pode ser feito para exames realizados.',
  futuro: 'Ainda não chegou o dia deste exame: não pode ser marcado como realizado ou falta.',
  backup: 'Não foi possível criar a cópia de segurança. Veja os registos do servidor.',
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
  const ortho = user.role === 'ortoptista';
  const item = (href, label, key, ico, extra = '', cls = '') =>
    html`<a href="${href}" class="nav-i${cls}${active === key ? ' active' : ''}"${active === key ? raw(' aria-current="page"') : ''}>${icon(ico)}<span class="nav-l">${label}</span>${extra}</a>`;
  const todayCount = ortho ? counts.porRegistarSiima + counts.relatoriosPendentes + counts.porFechar : counts.porMarcarSiima;
  return html`<nav class="nav" aria-label="Principal">
    ${item('/hoje', ortho ? 'Hoje' : 'Início', 'hoje', 'hoje', count(todayCount, 'owed'))}
    ${item('/pedidos', 'Pedidos', 'pedidos', 'pedidos', count(counts.porAgendar))}
    ${item('/agenda', 'Agenda', 'agenda', 'agenda')}
    ${ortho ? item('/estatistica', 'Estatística', 'estatistica', 'estatistica') : item('/pedidos/novo', 'Novo pedido', 'novo', 'mais', '', ' only-m')}
    ${ortho ? item('/admin', 'Admin.', 'admin', 'admin') : ''}
  </nav>`;
}

export const MARK = raw(`<svg class="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="7" class="mark-bg"/><path d="M4.5 16c3.4-4.6 7.3-6.9 11.5-6.9s8.1 2.3 11.5 6.9c-3.4 4.6-7.3 6.9-11.5 6.9S7.9 20.6 4.5 16z" class="mark-eye"/><circle cx="16" cy="16" r="4.2" class="mark-iris"/><circle cx="16" cy="16" r="1.7" class="mark-pupil"/></svg>`);

export function layout(req, { title, body, active = '', autorefresh = false, bare = false, wide = false }) {
  const user = req.user;
  const counts = req.counts || {};
  return `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#151D21" media="(prefers-color-scheme: dark)">
<meta name="color-scheme" content="light dark">
<title>${html`${title}`} · Ortóptica</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/static/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/static/icon-192.png">
<link rel="preload" href="/static/fonts/hyperlegible-next.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/static/app.css?v=${ASSET_VERSION}">
<script src="/static/app.js?v=${ASSET_VERSION}" defer></script>
</head>
<body${autorefresh ? ' data-autorefresh="300"' : ''}${bare ? ' class="bare"' : user ? ' class="has-nav"' : ''}>
<a class="skip" href="#conteudo">Saltar para o conteúdo</a>
${bare ? '' : html`<header class="top">
  <a class="brand" href="/hoje">${MARK}<span>Ortóptica</span></a>
  ${nav(user, counts, active)}
  ${user ? html`<div class="who"><a href="/conta" class="${active === 'conta' ? 'active' : ''}" title="A minha conta">${user.name}</a>
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
export function pageHead(title, { sub = '', actions = '', back = null } = {}) {
  return html`<div class="page-head">
    <div class="page-title">${back ? html`<a class="back" href="${back.href}">${icon('esq', 'ico sm')}${back.label}</a>` : ''}<h1>${title}</h1>${sub ? html`<p class="sub">${sub}</p>` : ''}</div>
    ${actions ? html`<div class="page-actions">${actions}</div>` : ''}
  </div>`;
}

export function statusPill(status) {
  return html`<span class="state s-${status}">${STATUS_LABEL[status] || status}</span>`;
}

/** Origem só aparece quando não é externo (o caso normal). */
export function originTag(origin, project) {
  if (origin === 'externo') return '';
  return html`<span class="origin o-${origin}">${ORIGIN_LABEL[origin] === 'Projeto interno' ? 'Projeto' : 'Ensaio'}${project ? html` <b>${project}</b>` : ''}</span>`;
}

export function proc(v) {
  return html`<span class="proc">${v}</span>`;
}

export function patientLabel(e) {
  return html`${proc(e.patient_process)}${e.patient_name ? html` <span class="pname">${e.patient_name}</span>` : ''}`;
}

/** Botão para copiar um código (processo, SAP) para escrever no Siima. Sem JS fica só o texto. */
export function copyable(value, label) {
  if (!value) return html`<span class="muted">—</span>`;
  return html`<button type="button" class="copy" data-copy="${value}" aria-label="Copiar ${label} ${value}">${value}${icon('copiar', 'ico xs')}</button>`;
}

/** Percurso compacto: cinco pontos + resumo em texto (o texto é o que conta para leitores de ecrã). */
export function track(e, { today = todayLocal(), label = true } = {}) {
  const t = examTrack(e, today);
  return html`<span class="track-wrap tone-${t.tone}"><span class="track" aria-hidden="true">${t.states.map((s) => html`<i class="${s}"></i>`)}</span>${label ? html`<span class="track-label">${t.summary}</span>` : html`<span class="sr">${t.summary}</span>`}</span>`;
}

export { STATIONS };

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
export function tape(t, row, { emptyText = 'Sem exames.' } = {}) {
  if (!t.items.length) return emptyState(emptyText);
  return html`<ol class="tape">${t.items.map((it) => {
    if (it.kind === 'gap') {
      return html`<li class="t-gap${it.past ? ' past' : ''}${it.minutes >= 60 ? ' long' : ''}"><span class="t-time"><time>${it.start}</time></span><span class="t-body">Livre · ${fmtDuration(it.minutes)} <span class="gap-end">até ${it.end}</span></span></li>`;
    }
    if (it.kind === 'block') {
      return html`<li class="t-block"><span class="t-time"><time>${it.start}</time><time class="end">${it.end}</time></span><span class="t-body"><b>Bloqueado</b> · ${it.block.reason}</span></li>`;
    }
    const e = it.exam;
    return html`<li class="t-exam s-${e.status}${e.is_electro ? ' electro' : ''}"><span class="t-time"><time>${it.start}</time><time class="end">${it.end}</time></span>${row(e)}</li>`;
  })}</ol>`;
}

/** Linha de exame reutilizada em listas e na fita. */
export function examLine(e, { actions = '', today = todayLocal(), when: showWhen = false, trackOn = true, href = `/exames/${e.id}` } = {}) {
  return html`<div class="ex">
    <div class="ex-main">
      ${showWhen && e.starts_at ? html`<span class="when">${fmtDate(e.starts_at).slice(0, 5)} ${e.starts_at.slice(11)}</span> ` : ''}<a class="ex-title" href="${href}">${e.type_name}</a>
      <div class="ex-meta">${patientLabel(e)}${originTag(e.origin, e.project)}${e.priority === 'urgente' && e.status === 'por_agendar' ? html`<span class="urgent">Urgente</span>` : ''}</div>
      ${trackOn ? html`<div class="ex-state">${track(e, { today })}</div>` : ''}
    </div>
    ${actions ? html`<div class="ex-actions">${actions}</div>` : ''}
  </div>`;
}

/** «terça, 27 de outubro» → «Terça, 27 de outubro» */
export function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

export function fmtD(d) { return fmtDate(d); }
