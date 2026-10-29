import { html, raw } from '../html.js';
import { getSetting } from '../db.js';
import { examsWhere } from '../repo.js';
import { SHOWN_STATUSES } from '../domain/status.js';
import { dayTape, fmtDuration } from '../domain/tape.js';
import { addDays, fmtDate, fmtDateLong, nowLocal, todayLocal, weekday } from '../time.js';
import { ageDays, cap, copyable, dayTapeByPeriod, emptyState, examLine, flash, help, originTag, pageHead, patientLabel, postButton } from '../ui.js';
import { send } from './util.js';
import { dueTasks, tasksEnabled } from '../tasks.js';
import { taskCard } from './tasks.js';

const BACK = '/hoje';
const IN_SHOWN = `(${SHOWN_STATUSES.map((s) => `'${s}'`).join(',')})`;

function reportLink(e) {
  if (e.status !== 'realizado') return '';
  if (e.report_status === 'validado') return html`<a class="btn ghost" href="/exames/${e.id}/relatorio">Ver relatório</a>`;
  return html`<a class="btn" href="/exames/${e.id}/relatorio">${e.report_status === 'rascunho' ? 'Continuar relatório' : 'Fazer relatório'}</a>`;
}

export function orthoActions(e, back = BACK) {
  return html`${e.status === 'agendado' ? html`${postButton(`/exames/${e.id}/realizado`, 'Realizado', { kind: 'primary', back })}${postButton(`/exames/${e.id}/faltou`, 'Faltou', { back, confirm: 'Registar falta?' })}` : ''}
    ${e.status === 'pendente' ? html`<a class="btn owed" href="#confirmar">Por confirmar</a>` : ''}
    ${reportLink(e)}
    ${e.status === 'realizado' && !e.siima_registered_at && e.source !== 'investigacao' ? postButton(`/exames/${e.id}/siima-registado`, 'Executado no Siima', { kind: 'owed', back: `${back}#siima` }) : ''}`;
}

export function dayData(db, date, { exams, nowTime = null }) {
  const windows = getSetting(db, 'availability').filter((w) => w.weekday === weekday(date));
  const next = `${addDays(date, 1)}T00:00`;
  const t = dayTape({
    date,
    windows,
    exams,
    holds: examsWhere(db, "e.change_kind = 'mover' AND e.change_starts_at >= ? AND e.change_starts_at < ?", [`${date}T00:00`, next]),
    blocks: db.prepare('SELECT * FROM blocks WHERE starts_at < ? AND ends_at > ? ORDER BY starts_at').all(next, `${date}T00:00`),
    step: getSetting(db, 'slot_step_min'),
    nowTime,
  });
  return { t, windows };
}

function daySummary(exams, t) {
  const live = exams.filter((e) => e.status !== 'faltou');
  const n = live.filter((e) => e.source !== 'investigacao').length;
  const r = live.length - n;
  const parts = [n ? `${n} ${n === 1 ? 'exame' : 'exames'}` : r ? '' : 'Sem exames'];
  if (r) parts.push(`${r} ${r === 1 ? 'avaliação de investigação' : 'avaliações de investigação'}`);
  if (t.freeMinutes) parts.push(`${fmtDuration(t.freeMinutes)} livre`);
  return parts.filter(Boolean).join(' · ');
}

function owedLine(items) {
  const shown = items.filter((i) => i.n);
  if (!shown.length) return html`<ul class="owed-line"><li class="clear">Nada em atraso.</li></ul>`;
  return html`<ul class="owed-line" aria-label="Pendentes">${shown.map((i) => html`<li><a href="${i.href}" class="${i.late ? 'late' : ''}"><span class="n">${i.n}</span>${i.label}</a></li>`)}</ul>`;
}

/** Agrupa por dia (lista de próximos). */
function byDay(exams, render) {
  const days = [];
  for (const e of exams) {
    const d = e.starts_at.slice(0, 10);
    if (!days.length || days.at(-1).date !== d) days.push({ date: d, items: [] });
    days.at(-1).items.push(e);
  }
  return days.map((d) => html`<div class="day-group"><h3 class="day-label">${cap(fmtDateLong(d.date))}</h3><ul class="list compact">${d.items.map((e) => html`<li>${render(e)}</li>`)}</ul></div>`);
}

const whenShort = (ldt) => `${cap(fmtDateLong(ldt.slice(0, 10)).split(',')[0]).slice(0, 3)} ${fmtDate(ldt).slice(0, 5)} ${ldt.slice(11)}`;

/** Uma reserva ou pedido de alteração à espera de decisão, com as ações ali mesmo. */
export function inboxItem(e, back = `${BACK}#confirmar`, { compact = false, openRefuse = null } = {}) {
  const base = back.split('#')[0].split('?')[0];
  const panelId = `recusa-${e.id}`;
  const open = openRefuse === e.id;
  const info = html`<div class="inbox-info">${compact ? '' : html`<a class="ex-title" href="/exames/${e.id}">${e.type_name}</a>`}
    <div class="ex-meta"><span class="when">${whenShort(e.starts_at)}</span>${e.booked_by_name ? html`<span class="by">por ${e.change_by_name || e.booked_by_name}</span>` : ''}${patientLabel(e)}</div>
    ${e.change_kind === 'mover' ? html`<p class="ask">Pede para mudar para <b class="when">${whenShort(e.change_starts_at)}</b>.</p>` : e.change_kind === 'cancelar' ? html`<p class="ask">Pede para <b>cancelar</b>.</p>` : ''}</div>`;
  const main = e.change_kind
    ? postButton(`/exames/${e.id}/alteracao/aceitar`, e.change_kind === 'mover' ? 'Aceitar nova hora' : 'Aceitar cancelamento', { kind: 'primary', back })
    : html`<form method="post" action="/exames/${e.id}/confirmar" class="inbox-confirm"><input type="hidden" name="back" value="${back}">
        ${e.requisition ? '' : html`<input name="requisition" maxlength="40" required placeholder="N.º de requisição" aria-label="N.º de requisição (obrigatório para confirmar)" class="mono">`}
        <button class="btn primary" type="submit">Confirmar</button></form>`;
  const refuseAction = e.change_kind ? `/exames/${e.id}/alteracao/recusar` : `/exames/${e.id}/recusar`;
  const note = e.change_kind ? 'Fica tudo como estava; o motivo aparece ao secretariado.' : 'A vaga fica livre; o motivo aparece ao secretariado.';
  return html`<li class="inbox-i" id="c-${e.id}">
    ${info}
    <div class="inbox-a">${main}
      <a class="btn" href="${base}?recusar=${e.id}#c-${e.id}" data-refuse="${panelId}" aria-controls="${panelId}" aria-expanded="${open ? 'true' : 'false'}">Recusar…</a></div>
    <form method="post" action="${refuseAction}" class="refuse-panel" id="${panelId}"${open ? '' : raw(' hidden')}>
      <input type="hidden" name="back" value="${back}">
      <label for="${panelId}-m">Motivo da recusa <span class="opt">opcional</span></label>
      <input id="${panelId}-m" name="note" maxlength="200" placeholder="p. ex. sem disponibilidade nesse dia">
      <a class="btn ghost" href="${back}" data-refuse-cancel="${panelId}">Cancelar</a>
      <button class="btn danger" type="submit">${e.change_kind ? 'Recusar pedido' : 'Recusar reserva'}</button>
      <p class="refuse-note">${note}</p>
    </form></li>`;
}

function orthoPage(req, db) {
  const today = todayLocal();
  const c = req.counts;
  const todays = examsWhere(db, `e.status IN ${IN_SHOWN} AND e.starts_at >= ? AND e.starts_at < ?`, [`${today}T00:00`, `${addDays(today, 1)}T00:00`]);
  const inbox = examsWhere(db, "e.status = 'pendente' OR e.change_kind IS NOT NULL", [], 'e.change_requested_at IS NULL, COALESCE(e.change_requested_at, e.created_at)');
  const porFechar = examsWhere(db, "e.status = 'agendado' AND e.starts_at < ?", [`${today}T00:00`]);
  const porRegistar = examsWhere(db, "r.source <> 'investigacao' AND e.status = 'realizado' AND e.siima_registered_at IS NULL", [], 'e.starts_at');
  const porMarcar = examsWhere(db, "r.source = 'direto' AND e.status = 'agendado' AND e.siima_booked_at IS NULL", [], 'e.starts_at');
  const relatorios = examsWhere(db, "e.status = 'realizado' AND (rp.id IS NULL OR rp.status = 'rascunho')", [], 'e.starts_at');
  const proximos = examsWhere(db, "e.status IN ('agendado','pendente') AND e.starts_at >= ? AND e.starts_at < ?", [`${addDays(today, 1)}T00:00`, `${addDays(today, 8)}T00:00`]);
  const oldest = c.porRegistarAntigo ? ageDays(c.porRegistarAntigo.slice(0, 10), today) : 0;
  const { t, windows } = dayData(db, today, { exams: todays, nowTime: nowLocal().slice(11) });
  const tasks = tasksEnabled(db) ? dueTasks(db, today) : [];

  return {
    title: 'Hoje',
    active: 'hoje',
    autorefresh: true,
    body: html`
      ${pageHead(cap(fmtDateLong(today)), { sub: html`<span>${daySummary(todays, t)}</span>` })}
      ${owedLine([
        { n: inbox.length, label: 'por confirmar', href: '#confirmar' },
        { n: porFechar.length, label: 'por fechar', href: '#fechar', late: true },
        { n: relatorios.length, label: relatorios.length === 1 ? 'relatório por validar' : 'relatórios por validar', href: '#relatorios' },
        { n: porRegistar.length, label: 'por executar no Siima', href: '#siima', late: oldest > 2 },
        { n: porMarcar.length, label: 'por marcar no Siima', href: '#marcar' },
      ])}
      ${flash(req.query, req)}
      ${inbox.length ? html`<section class="sec inbox" id="confirmar" aria-labelledby="h-conf">
        <div class="sec-h"><h2 id="h-conf">Por confirmar</h2><span class="count owed">${inbox.length}</span>${help(html`<p>Reservas e pedidos feitos pelo secretariado no link de reservas.</p><p>Para confirmar uma reserva é preciso o n.º de requisição. Ao recusar, o motivo aparece ao secretariado.</p>`)}</div>
        <ul class="list">${inbox.map((e) => inboxItem(e, undefined, { openRefuse: Number(req.query.recusar) || null }))}</ul>
      </section>` : ''}
      <div class="work">
        <div>
          <section class="sec" aria-labelledby="h-hoje">
            <div class="sec-h"><h2 id="h-hoje">Agenda de hoje</h2><span class="aside"><a href="/investigacao/nova">Registar avaliação de investigação</a> · <a href="/agenda">Semana</a></span></div>
            ${dayTapeByPeriod(t, windows, (e) => html`<div class="t-body">${examLine(e, { today, actions: orthoActions(e) })}</div>`, { emptyText: 'Sem exames nem horário hoje.', holdHref: (e) => `/exames/${e.id}` })}
          </section>
        </div>
        <aside class="side" aria-label="Pendentes">
          ${tasks.length ? html`<section class="sec" id="tarefas" aria-labelledby="h-tarefas">
            <div class="sec-h"><h2 id="h-tarefas">Tarefas para hoje</h2><span class="count owed">${tasks.length}</span><span class="aside"><a href="/tarefas">Quadro</a></span></div>
            <ul class="tk-cards tk-today">${tasks.map((x) => taskCard(x, { today, back: `${BACK}#tarefas`, draggable: false }))}</ul>
          </section>` : ''}
          ${porFechar.length ? html`<section class="sec" id="fechar" aria-labelledby="h-fechar">
            <div class="sec-h"><h2 id="h-fechar">Por fechar</h2><span class="count">${porFechar.length}</span>${help('Já passaram e não foram marcados como realizados nem falta.')}</div>
            <ul class="list">${porFechar.map((e) => html`<li>${examLine(e, { today, when: true, trackOn: false, actions: orthoActions(e) })}</li>`)}</ul>
          </section>` : ''}
          <section class="sec" id="relatorios" aria-labelledby="h-rel">
            <div class="sec-h"><h2 id="h-rel">Relatórios por validar</h2>${relatorios.length ? html`<span class="count">${relatorios.length}</span>` : ''}</div>
            ${relatorios.length ? html`<ul class="list">${relatorios.map((e) => html`<li>${examLine(e, { today, when: true, trackOn: false, href: `/exames/${e.id}/relatorio`, actions: reportLink(e) })}</li>`)}</ul>`
              : html`<p class="empty clear">Todos validados.</p>`}
          </section>
          <section class="sec" id="siima" aria-labelledby="h-siima">
            <div class="sec-h"><h2 id="h-siima">Por executar no Siima</h2>${porRegistar.length ? html`<span class="count owed">${porRegistar.length}</span>` : ''}
              ${oldest > 2 ? html`<span class="aside late-note">o mais antigo há ${oldest} dias</span>` : ''}</div>
            ${porRegistar.length ? html`<ul class="list">${porRegistar.map((e) => {
              const age = ageDays(e.starts_at.slice(0, 10), today);
              return html`<li class="siima">
                <div><span class="when">${fmtDate(e.starts_at).slice(0, 5)}</span> <a class="ex-title" href="/exames/${e.id}">${e.type_name}</a>${age > 2 ? html` <span class="age">há ${age} dias</span>` : ''}
                  <div class="siima-codes">${e.requisition ? html`<span>Requisição ${copyable(e.requisition, 'requisição')}</span>` : ''}${e.patient_process ? html`<span>Processo ${copyable(e.patient_process, 'processo')}</span>` : ''}</div></div>
                ${postButton(`/exames/${e.id}/siima-registado`, 'Executado', { kind: 'owed', back: `${BACK}#siima` })}</li>`;
            })}</ul>` : html`<p class="empty clear">Tudo executado no Siima.</p>`}
          </section>
          ${porMarcar.length ? html`<section class="sec" id="marcar" aria-labelledby="h-marcar">
            <div class="sec-h"><h2 id="h-marcar">Por marcar no Siima</h2><span class="count owed">${porMarcar.length}</span>${help('Exames fora do circuito do secretariado: a marcação no Siima é consigo.')}</div>
            <ul class="list">${porMarcar.map((e) => html`<li class="siima">
              <div><span class="when">${fmtDate(e.starts_at).slice(0, 5)} ${e.starts_at.slice(11)}</span> <a class="ex-title" href="/exames/${e.id}">${e.type_name}</a>
                <div class="siima-codes"><span>Processo ${copyable(e.patient_process, 'processo')}</span>${e.requisition ? html`<span>Requisição ${copyable(e.requisition, 'requisição')}</span>` : ''}</div></div>
              ${postButton(`/exames/${e.id}/siima-marcado`, 'Marcado', { kind: 'owed', back: `${BACK}#marcar` })}</li>`)}</ul>
          </section>` : ''}
        </aside>
        <div class="after">
          <section class="sec quiet" aria-labelledby="h-prox">
            <div class="sec-h"><h2 id="h-prox">Próximos 7 dias</h2><span class="aside"><a href="/agenda">Ver agenda</a></span></div>
            ${proximos.length ? byDay(proximos, (e) => html`<div class="ex"><div class="ex-main"><span class="when">${e.starts_at.slice(11)}</span> <a class="ex-title" href="/exames/${e.id}">${e.type_name}</a>
                <div class="ex-meta">${patientLabel(e)}${originTag(e.origin, e.project, e.source)}${e.status === 'pendente' ? html`<span class="owed-txt">por confirmar</span>` : ''}${e.source === 'direto' && !e.siima_booked_at ? html`<span class="owed-txt">por marcar no Siima</span>` : ''}</div></div></div>`)
              : emptyState('Nada agendado nos próximos 7 dias.')}
          </section>
        </div>
      </div>`,
  };
}

export default async function todayRoutes(app, { db }) {
  app.get('/', async (req, reply) => reply.redirect('/hoje'));
  app.get('/hoje', async (req, reply) => send(reply, req, orthoPage(req, db)));
}
