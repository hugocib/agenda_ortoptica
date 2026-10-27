import { html } from '../html.js';
import { getSetting } from '../db.js';
import { examsWhere } from '../repo.js';
import { dayTape, fmtDuration } from '../domain/tape.js';
import { addDays, fmtDate, fmtDateLong, nowLocal, todayLocal, weekday } from '../time.js';
import { ageDays, cap, copyable, emptyState, examLine, flash, originTag, pageHead, postButton, tape } from '../ui.js';
import { send } from './util.js';

const BACK = '/hoje';

function reportLink(e) {
  if (e.status !== 'realizado') return '';
  if (e.report_status === 'validado') return html`<a class="btn ghost" href="/exames/${e.id}/relatorio">Ver relatório</a>`;
  return html`<a class="btn" href="/exames/${e.id}/relatorio">${e.report_status === 'rascunho' ? 'Continuar relatório' : 'Fazer relatório'}</a>`;
}

function orthoActions(e, back = BACK) {
  return html`${e.status === 'agendado' ? html`${postButton(`/exames/${e.id}/realizado`, 'Realizado', { kind: 'primary', back })}${postButton(`/exames/${e.id}/faltou`, 'Faltou', { back, confirm: 'Registar falta?' })}` : ''}
    ${reportLink(e)}
    ${e.status === 'realizado' && !e.siima_registered_at ? postButton(`/exames/${e.id}/siima-registado`, 'Registado no Siima', { kind: 'owed', back: `${back}#siima` }) : ''}`;
}

function todayTape(db, today, exams) {
  const t = dayTape({
    date: today,
    windows: getSetting(db, 'availability').filter((w) => w.weekday === weekday(today)),
    exams,
    blocks: db.prepare('SELECT * FROM blocks WHERE starts_at < ? AND ends_at > ? ORDER BY starts_at').all(`${addDays(today, 1)}T00:00`, `${today}T00:00`),
    step: getSetting(db, 'slot_step_min'),
    nowTime: nowLocal().slice(11),
  });
  return t;
}

function daySummary(exams, t) {
  const n = exams.filter((e) => e.status !== 'faltou').length;
  const parts = [n ? `${n} ${n === 1 ? 'exame' : 'exames'}` : 'Sem exames'];
  if (t.freeMinutes) parts.push(`${fmtDuration(t.freeMinutes)} livre`);
  return parts.join(' · ');
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

function orthoPage(req, db) {
  const today = todayLocal();
  const c = req.counts;
  const todays = examsWhere(db, "e.status IN ('agendado','realizado','faltou') AND e.starts_at >= ? AND e.starts_at < ?", [`${today}T00:00`, `${addDays(today, 1)}T00:00`]);
  const porFechar = examsWhere(db, "e.status = 'agendado' AND e.starts_at < ?", [`${today}T00:00`]);
  const porRegistar = examsWhere(db, "e.status = 'realizado' AND e.siima_registered_at IS NULL", [], 'e.starts_at');
  const relatorios = examsWhere(db, "e.status = 'realizado' AND (rp.id IS NULL OR rp.status = 'rascunho')", [], 'e.starts_at');
  const proximos = examsWhere(db, "e.status = 'agendado' AND e.starts_at >= ? AND e.starts_at < ?", [`${addDays(today, 1)}T00:00`, `${addDays(today, 8)}T00:00`]);
  const oldest = c.porRegistarAntigo ? ageDays(c.porRegistarAntigo.slice(0, 10), today) : 0;
  const t = todayTape(db, today, todays);

  return {
    title: 'Hoje',
    active: 'hoje',
    autorefresh: true,
    body: html`
      ${pageHead(cap(fmtDateLong(today)), {
        sub: html`<span>${daySummary(todays, t)}</span>`,
      })}
      ${owedLine([
        { n: porFechar.length, label: porFechar.length === 1 ? 'por fechar' : 'por fechar', href: '#fechar', late: true },
        { n: relatorios.length, label: relatorios.length === 1 ? 'relatório por validar' : 'relatórios por validar', href: '#relatorios' },
        { n: porRegistar.length, label: 'por registar no Siima', href: '#siima', late: oldest > 2 },
      ])}
      ${flash(req.query, req)}
      <div class="work">
        <div>
          <section class="sec" aria-labelledby="h-hoje">
            <div class="sec-h"><h2 id="h-hoje">Agenda de hoje</h2><span class="aside"><a href="/agenda">Semana</a></span></div>
            ${tape(t, (e) => html`<div class="t-body">${examLine(e, { today, actions: orthoActions(e) })}</div>`, { emptyText: 'Sem exames nem horário hoje.' })}
          </section>

        </div>
        <aside class="side" aria-label="Pendentes">
          ${porFechar.length ? html`<section class="sec" id="fechar" aria-labelledby="h-fechar">
            <div class="sec-h"><h2 id="h-fechar">Por fechar</h2><span class="count">${porFechar.length}</span></div>
            <p class="sec-note">Já passaram e não foram marcados como realizados nem falta.</p>
            <ul class="list">${porFechar.map((e) => html`<li>${examLine(e, { today, when: true, trackOn: false, actions: orthoActions(e) })}</li>`)}</ul>
          </section>` : ''}
          <section class="sec" id="relatorios" aria-labelledby="h-rel">
            <div class="sec-h"><h2 id="h-rel">Relatórios por validar</h2>${relatorios.length ? html`<span class="count">${relatorios.length}</span>` : ''}</div>
            ${relatorios.length ? html`<ul class="list">${relatorios.map((e) => html`<li>${examLine(e, { today, when: true, trackOn: false, href: `/exames/${e.id}/relatorio`, actions: reportLink(e) })}</li>`)}</ul>`
              : html`<p class="empty clear">Todos validados.</p>`}
          </section>
          <section class="sec" id="siima" aria-labelledby="h-siima">
            <div class="sec-h"><h2 id="h-siima">Por registar no Siima</h2>${porRegistar.length ? html`<span class="count owed">${porRegistar.length}</span>` : ''}
              ${oldest > 2 ? html`<span class="aside late-note">o mais antigo há ${oldest} dias</span>` : ''}</div>
            ${porRegistar.length ? html`<ul class="list">${porRegistar.map((e) => {
              const age = ageDays(e.starts_at.slice(0, 10), today);
              return html`<li class="siima">
                <div><span class="when">${fmtDate(e.starts_at).slice(0, 5)}</span> <a class="ex-title" href="/exames/${e.id}">${e.type_name}</a>${age > 2 ? html` <span class="age">há ${age} dias</span>` : ''}
                  <div class="siima-codes"><span>Processo ${copyable(e.patient_process, 'processo')}</span><span>SAP ${copyable(e.sap_code, 'código SAP')}</span></div></div>
                ${postButton(`/exames/${e.id}/siima-registado`, 'Registado', { kind: 'owed', back: `${BACK}#siima` })}</li>`;
            })}</ul>` : html`<p class="empty clear">Tudo registado no Siima.</p>`}
          </section>
        </aside>
        <div class="after">
          <section class="sec quiet" aria-labelledby="h-prox">
            <div class="sec-h"><h2 id="h-prox">Próximos 7 dias</h2><span class="aside"><a href="/agenda">Ver agenda</a></span></div>
            ${proximos.length ? byDay(proximos, (e) => html`<div class="ex"><div class="ex-main"><span class="when">${e.starts_at.slice(11)}</span> <a class="ex-title" href="/exames/${e.id}">${e.type_name}</a>
                <div class="ex-meta">${patientLine(e)}${originTag(e.origin, e.project)}${!e.siima_booked_at ? html`<span class="owed-txt">por marcar no Siima</span>` : ''}</div></div></div>`)
              : emptyState('Nada agendado nos próximos 7 dias.')}
          </section>
        </div>
      </div>`,
  };
}

function patientLine(e) {
  return html`<span class="proc">${e.patient_process}</span>${e.patient_name ? html` <span class="pname">${e.patient_name}</span>` : ''}`;
}

function secPage(req, db) {
  const today = todayLocal();
  const porMarcar = examsWhere(db, "e.status = 'agendado' AND e.siima_booked_at IS NULL", [], 'e.starts_at');
  const porAgendar = examsWhere(db, "e.status = 'por_agendar'", [], "r.priority = 'urgente' DESC, e.created_at");
  const todays = examsWhere(db, "e.status IN ('agendado','realizado','faltou') AND e.starts_at >= ? AND e.starts_at < ?", [`${today}T00:00`, `${addDays(today, 1)}T00:00`]);
  const t = todayTape(db, today, todays);
  const urgent = porAgendar.filter((e) => e.priority === 'urgente').length;
  return {
    title: 'Início',
    active: 'hoje',
    autorefresh: true,
    body: html`
      ${pageHead(cap(fmtDateLong(today)), {
        sub: html`<span>${daySummary(todays, t)}</span>`,
        actions: html`<a class="btn primary big" href="/pedidos/novo">Novo pedido</a>`,
      })}
      ${owedLine([
        { n: porMarcar.length, label: 'por marcar no Siima', href: '#siima' },
        { n: porAgendar.length, label: 'por agendar', href: '#agendar', late: urgent > 0 },
      ])}
      ${flash(req.query, req)}
      <div class="work">
        <div>
          <section class="sec" id="siima" aria-labelledby="h-siima">
            <div class="sec-h"><h2 id="h-siima">Por marcar no Siima</h2>${porMarcar.length ? html`<span class="count owed">${porMarcar.length}</span>` : ''}</div>
            ${porMarcar.length ? html`<p class="sec-note">Já têm hora na app. Marque no Siima e confirme aqui.</p><ul class="list">${porMarcar.map((e) => html`<li class="siima">
                <div><span class="when">${fmtDate(e.starts_at)} ${e.starts_at.slice(11)}</span> <a class="ex-title" href="/exames/${e.id}">${e.type_name}</a>
                  <div class="siima-codes"><span>Processo ${copyable(e.patient_process, 'processo')}</span><span>SAP ${copyable(e.sap_code, 'código SAP')}</span>${e.patient_name ? html`<span class="pname">${e.patient_name}</span>` : ''}</div></div>
                ${postButton(`/exames/${e.id}/siima-marcado`, 'Marcado no Siima', { kind: 'owed', back: `${BACK}#siima` })}</li>`)}</ul>`
              : html`<p class="empty clear">Tudo marcado no Siima.</p>`}
          </section>
          <section class="sec" id="agendar" aria-labelledby="h-agendar">
            <div class="sec-h"><h2 id="h-agendar">Por agendar</h2>${porAgendar.length ? html`<span class="count">${porAgendar.length}</span>` : ''}${urgent ? html`<span class="aside late-note">${urgent} ${urgent === 1 ? 'urgente' : 'urgentes'}</span>` : ''}</div>
            ${porAgendar.length ? html`<ul class="list">${porAgendar.map((e) => html`<li>${examLine(e, {
                today, trackOn: false,
                actions: html`<span class="muted small">pedido de ${fmtDate(e.created_at).slice(0, 5)}</span><a class="btn primary" href="/exames/${e.id}/agendar">Agendar</a>`,
              })}</li>`)}</ul>`
              : emptyState('Nenhum exame por agendar.')}
          </section>
        </div>
        <aside class="side">
          <section class="sec quiet" aria-labelledby="h-hoje">
            <div class="sec-h"><h2 id="h-hoje">Hoje</h2><span class="aside"><a href="/agenda">Semana</a></span></div>
            ${tape(t, (e) => html`<div class="t-body">${examLine(e, { today })}</div>`, { emptyText: 'Sem exames hoje.' })}
          </section>
        </aside>
      </div>`,
  };
}

export default async function todayRoutes(app, { db }) {
  app.get('/', async (req, reply) => reply.redirect('/hoje'));
  app.get('/hoje', async (req, reply) => send(reply, req, req.user.role === 'ortoptista' ? orthoPage(req, db) : secPage(req, db)));
}
