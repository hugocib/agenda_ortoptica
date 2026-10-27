import { html, euros } from '../html.js';
import { getSetting } from '../db.js';
import { getExam, scheduleContext, scheduleExam, setSiimaBooked, setSiimaRegistered, transitionExam } from '../repo.js';
import { freeSlots, roundUp } from '../domain/slots.js';
import { canTransition, examTrack, ORIGIN_LABEL, STATIONS } from '../domain/status.js';
import { addDays, fmtDate, fmtDateLong, fmtUtcLocal, isLocalDateTime, nowLocal, todayLocal } from '../time.js';
import { cap, copyable, emptyState, flash, originTag, pageHead, patientLabel, postButton, when } from '../ui.js';
import { idParam, safeBack, send, str, withMsg, withParam } from './util.js';

const ACTION_MSG = {
  desmarcar: 'desmarcado', cancelar: 'cancelado', realizado: 'realizado', faltou: 'faltou', anular_realizado: 'anulado',
};

export default async function examRoutes(app, { db }) {
  app.get('/exames/:id', async (req, reply) => {
    const id = idParam(req);
    const e = id && getExam(db, id);
    if (!e) return reply.callNotFound();
    const role = req.user.role;
    const back = `/exames/${id}`;
    const log = db.prepare(`SELECT a.at, a.action, u.display_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity = 'exame' AND a.entity_id = ? ORDER BY a.id DESC LIMIT 30`).all(id);
    const future = Boolean(e.starts_at && e.starts_at.slice(0, 10) > todayLocal());
    const can = (a) => canTransition(a, e.status, role) && !(future && (a === 'realizado' || a === 'faltou'));
    const today = todayLocal();
    const t = examTrack(e, today);
    const ortho = role === 'ortoptista';
    // Cada estação: estado, quando aconteceu e o botão que a faz avançar (ou desfaz).
    const stopInfo = [
      { meta: e.starts_at ? `${fmtDate(e.starts_at)} ${e.starts_at.slice(11)}–${e.ends_at.slice(11)}` : '',
        act: html`${can('agendar') ? html`<a class="btn primary" href="/exames/${id}/agendar">Agendar</a>` : ''}${can('reagendar') ? html`<a class="btn" href="/exames/${id}/agendar">Reagendar</a>` : ''}` },
      { meta: e.siima_booked_at ? fmtUtcLocal(e.siima_booked_at) : '',
        act: e.siima_booked_at ? postButton(`/exames/${id}/siima-marcado/desfazer`, 'desfazer', { kind: 'link', back })
          : ['agendado', 'realizado'].includes(e.status) ? postButton(`/exames/${id}/siima-marcado`, 'Marcado no Siima', { kind: 'owed', back }) : '' },
      { meta: e.performed_at ? fmtUtcLocal(e.performed_at) : e.status === 'faltou' ? 'Faltou' : future && e.status === 'agendado' ? 'ainda não chegou o dia' : '',
        act: html`${can('realizado') ? postButton(`/exames/${id}/realizado`, e.status === 'faltou' ? 'Afinal realizado' : 'Realizado', { kind: e.status === 'faltou' ? '' : 'primary', back }) : ''}${can('faltou') ? postButton(`/exames/${id}/faltou`, 'Faltou', { back, confirm: 'Registar falta?' }) : ''}` },
      { meta: e.report_status === 'rascunho' ? 'rascunho' : e.report_status === 'validado' ? 'validado' : '',
        act: ortho && e.status === 'realizado' ? html`<a class="btn${e.report_status === 'validado' ? ' ghost' : ''}" href="/exames/${id}/relatorio">${e.report_status === 'validado' ? 'Ver relatório' : e.report_status ? 'Continuar' : 'Fazer relatório'}</a>` : '' },
      { meta: e.siima_registered_at ? fmtUtcLocal(e.siima_registered_at) : '',
        act: html`${ortho && e.siima_registered_at ? postButton(`/exames/${id}/siima-registado/desfazer`, 'desfazer', { kind: 'link', back }) : ''}${ortho && e.status === 'realizado' && !e.siima_registered_at ? postButton(`/exames/${id}/siima-registado`, 'Registado no Siima', { kind: 'owed', back }) : ''}` },
    ];
    const secondary = html`${can('desmarcar') ? postButton(`/exames/${id}/desmarcar`, 'Desmarcar', { back, confirm: 'Remover a marcação? (lembre-se de desmarcar também no Siima)' }) : ''}
      ${can('anular_realizado') && !e.siima_registered_at ? postButton(`/exames/${id}/anular_realizado`, 'Anular «realizado»', { back, confirm: 'Voltar a pôr o exame como agendado?' }) : ''}
      ${can('cancelar') ? postButton(`/exames/${id}/cancelar`, 'Cancelar exame', { kind: 'danger', back, confirm: 'Cancelar este exame?' }) : ''}`;
    return send(reply, req, {
      title: e.type_name,
      active: 'pedidos',
      body: html`${pageHead(e.type_name, {
          back: { href: `/pedidos/${e.request_id}`, label: html`Pedido <span class="mono">#${e.request_id}</span>` },
          sub: html`${patientLabel(e)}${originTag(e.origin, e.project)}<span class="track-wrap tone-${t.tone}"><span class="track-label">${t.summary}</span></span>`,
        })}
        ${flash(req.query, req)}
        <section class="sec" aria-label="Percurso do exame">
          <ol class="route">${STATIONS.map((st, i) => html`<li class="stop ${t.states[i]}">
            <div class="stop-l">${st.label}</div>
            ${stopInfo[i].meta ? html`<div class="stop-m">${stopInfo[i].meta}</div>` : ''}
            <span class="sr">${{ done: 'feito', next: 'por fazer', todo: 'ainda não', draft: 'em rascunho', fail: 'falhou', off: 'não se aplica' }[t.states[i]]}</span>
            ${String(stopInfo[i].act).trim() ? html`<div class="stop-a">${stopInfo[i].act}</div>` : ''}
          </li>`)}</ol>
          ${String(secondary).trim() ? html`<div class="more-actions"><span class="lead">Outras ações</span>${secondary}</div>` : ''}
        </section>
        <div class="two-col">
          <section class="sec quiet">
            <div class="sec-h"><h2>Dados</h2></div>
            <dl class="facts">
              <div><dt>Data</dt><dd>${when(e)}${e.ends_at ? `–${e.ends_at.slice(11)}` : ''}</dd></div>
              <div><dt>Duração</dt><dd>${e.minutes} min${e.is_electro ? ' · eletrofisiologia' : ''}</dd></div>
              <div><dt>Código SAP</dt><dd>${copyable(e.sap_code, 'código SAP')}</dd></div>
              <div><dt>Processo</dt><dd>${copyable(e.patient_process, 'processo')}</dd></div>
              <div><dt>Origem</dt><dd>${ORIGIN_LABEL[e.origin]}${e.project ? ` — ${e.project}` : ''}</dd></div>
              ${ortho ? html`<div><dt>Preço (no pedido)</dt><dd>${euros(e.price_cents)}</dd></div>` : ''}
              ${e.referrer ? html`<div><dt>Requisitante</dt><dd>${e.referrer}</dd></div>` : ''}
            </dl>
            ${e.notes ? html`<h3 class="day-label">Notas do pedido</h3><p class="notes">${e.notes}</p>` : ''}
          </section>
          <section class="sec quiet">
            <div class="sec-h"><h2>Histórico</h2></div>
            ${log.length ? html`<ul class="log">${log.map((l) => html`<li><time>${fmtUtcLocal(l.at)}</time><span>${l.action.replace(/_/g, ' ')} · ${l.display_name || '—'}</span></li>`)}</ul>` : emptyState('Sem registos.')}
          </section>
        </div>`,
    });
  });

  app.get('/exames/:id/agendar', async (req, reply) => {
    const id = idParam(req);
    const e = id && getExam(db, id);
    if (!e) return reply.callNotFound();
    if (!['por_agendar', 'agendado'].includes(e.status)) return reply.redirect(`/exames/${id}?err=estado`);
    const today = todayLocal();
    const weeks = getSetting(db, 'horizon_weeks');
    const days = weeks * 7;
    const ctx = scheduleContext(db, today, addDays(today, days));
    const slots = freeSlots({ fromDate: today, days, minutes: e.minutes, isElectro: !!e.is_electro, ...ctx, now: nowLocal(), ignoreExamId: e.id });
    const withTimes = slots.filter((d) => d.times.length);
    return send(reply, req, {
      title: 'Agendar',
      active: 'pedidos',
      body: html`${pageHead(html`${e.status === 'agendado' ? 'Reagendar' : 'Escolher hora'}`, { back: { href: `/pedidos/${e.request_id}`, label: html`Pedido <span class="mono">#${e.request_id}</span>` } })}
        ${flash(req.query, req)}
        <div class="ctx"><span class="ex-title">${e.type_name}</span><span>${patientLabel(e)}</span>${originTag(e.origin, e.project)}
          <span class="muted">ocupa <strong>${roundUp(e.minutes, ctx.step)} min</strong>${e.is_electro ? ` · eletrofisiologia, máx. ${ctx.maxElectro} por dia` : ''}</span></div>
        ${e.status === 'agendado' ? html`<div class="notice warn"><p>Está marcado para <strong>${when(e)}</strong>. Ao escolher outra hora, desmarque também a antiga no Siima.</p></div>` : ''}
        ${withTimes.length ? html`<form method="post" action="/exames/${id}/agendar">
          <p class="sec-note">Só aparecem vagas livres nas próximas ${weeks} semanas. Um toque numa hora marca-a.</p>
          <div class="slot-days">${withTimes.map((d) => html`<section class="slot-day"><h2>${cap(fmtDateLong(d.date))} <span class="muted">${fmtDate(d.date)}</span></h2>
            <div class="slot-times">${d.times.map((t) => html`<button class="slot" type="submit" name="starts_at" value="${d.date}T${t}" aria-label="${fmtDateLong(d.date)} às ${t}">${t}</button>`)}</div></section>`)}</div>
        </form>` : html`<p class="empty">Não há vagas nas próximas ${weeks} semanas para um exame de ${roundUp(e.minutes, ctx.step)} min. ${role === 'ortoptista' ? html`Pode alargar o horário em <a href="/admin">Administração</a> ou remover <a href="/bloqueios">bloqueios</a>.` : 'Fale com o ortoptista para abrir horário.'}</p>`}`,
    });
  });

  app.post('/exames/:id/agendar', async (req, reply) => {
    const id = idParam(req);
    if (!id) return reply.callNotFound();
    const startsAt = str(req.body?.starts_at);
    if (!isLocalDateTime(startsAt)) return reply.redirect(`/exames/${id}/agendar?err=hora_invalida`);
    const res = scheduleExam(db, req.user, id, startsAt);
    if (!res.ok) return reply.redirect(`/exames/${id}/agendar?err=${res.reason}`);
    const e = getExam(db, id);
    // Volta ao pedido se ainda houver exames por agendar; senão, ao início.
    const pending = db.prepare("SELECT COUNT(*) FROM exams WHERE request_id = ? AND status = 'por_agendar'").pluck().get(e.request_id);
    const msg = res.action === 'reagendar' ? 'reagendado' : 'agendado';
    return reply.redirect(pending ? `/pedidos/${e.request_id}?msg=${msg}` : `/hoje?msg=${msg}`);
  });

  for (const action of ['desmarcar', 'cancelar', 'realizado', 'faltou', 'anular_realizado']) {
    app.post(`/exames/:id/${action}`, async (req, reply) => {
      const id = idParam(req);
      if (!id) return reply.callNotFound();
      const back = safeBack(req.body?.back, `/exames/${id}`);
      const res = transitionExam(db, req.user, id, action);
      return reply.redirect(res.ok ? withMsg(back, ACTION_MSG[action], id) : withParam(back, 'err', res.reason));
    });
  }

  const siima = [
    ['siima-marcado', (u, id) => setSiimaBooked(db, u, id, true), 'siima_marcado'],
    ['siima-marcado/desfazer', (u, id) => setSiimaBooked(db, u, id, false), 'desfeito'],
    ['siima-registado', (u, id) => setSiimaRegistered(db, u, id, true), 'siima_registado'],
    ['siima-registado/desfazer', (u, id) => setSiimaRegistered(db, u, id, false), 'desfeito'],
  ];
  for (const [path, fn, msg] of siima) {
    app.post(`/exames/:id/${path}`, async (req, reply) => {
      const id = idParam(req);
      if (!id) return reply.callNotFound();
      const back = safeBack(req.body?.back, `/exames/${id}`);
      const res = fn(req.user, id);
      return reply.redirect(res.ok ? withMsg(back, msg, id) : withParam(back, 'err', res.reason));
    });
  }
}
