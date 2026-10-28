import { html, raw } from '../html.js';
import { getSetting } from '../db.js';
import {
  confirmReservation, decideChange, getExam, scheduleContext, scheduleExam, setRequisition, setSiimaBooked, setSiimaRegistered, transitionExam,
} from '../repo.js';
import { freeSlots, roundUp } from '../domain/slots.js';
import { canTransition, examTrack, ORIGIN_LABEL, SOURCE_LABEL, sourceOf } from '../domain/status.js';
import { addDays, fmtDate, fmtDateLong, fmtUtcLocal, isLocalDateTime, nowLocal, todayLocal, weekday } from '../time.js';
import { cap, copyable, dateInput, emptyState, flash, help, originTag, pageHead, patientLabel, postButton, when } from '../ui.js';
import { idParam, safeBack, send, str, withMsg, withParam } from './util.js';
import { inboxItem } from './today.js';

const ACTION_MSG = {
  desmarcar: 'desmarcado', cancelar: 'cancelado', realizado: 'realizado', faltou: 'faltou', anular_realizado: 'anulado', recusar: 'recusado',
};

const STATE_SR = { done: 'feito', next: 'por fazer', todo: 'ainda não', draft: 'em rascunho', fail: 'não aconteceu', off: 'não se aplica' };

export default async function examRoutes(app, { db }) {
  app.get('/exames/:id', async (req, reply) => {
    const id = idParam(req);
    const e = id && getExam(db, id);
    if (!e) return reply.callNotFound();
    const source = sourceOf(e);
    const back = `/exames/${id}`;
    const log = db.prepare(`SELECT a.at, a.action, a.detail, u.display_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity = 'exame' AND a.entity_id = ? ORDER BY a.id DESC LIMIT 30`).all(id);
    const future = Boolean(e.starts_at && e.starts_at.slice(0, 10) > todayLocal());
    const can = (a) => canTransition(a, e.status, source) && !(future && (a === 'realizado' || a === 'faltou'));
    const t = examTrack(e, todayLocal());

    const slotMeta = e.starts_at ? `${fmtDate(e.starts_at)} ${e.starts_at.slice(11)}–${e.ends_at.slice(11)}` : '';
    const performed = {
      meta: e.performed_at ? fmtUtcLocal(e.performed_at) : e.status === 'faltou' ? 'Faltou' : future && e.status === 'agendado' ? 'ainda não chegou o dia' : '',
      act: html`${can('realizado') ? postButton(`/exames/${id}/realizado`, e.status === 'faltou' ? 'Afinal realizado' : 'Realizado', { kind: e.status === 'faltou' ? '' : 'primary', back }) : ''}${can('faltou') ? postButton(`/exames/${id}/faltou`, 'Faltou', { back, confirm: 'Registar falta?' }) : ''}`,
    };
    const report = {
      meta: e.report_status === 'rascunho' ? 'rascunho' : e.report_status === 'validado' ? 'validado' : '',
      act: e.status === 'realizado' ? html`<a class="btn${e.report_status === 'validado' ? ' ghost' : ''}" href="/exames/${id}/relatorio">${e.report_status === 'validado' ? 'Ver relatório' : e.report_status ? 'Continuar' : 'Fazer relatório'}</a>` : '',
    };
    const executed = {
      meta: e.siima_registered_at ? fmtUtcLocal(e.siima_registered_at) : '',
      act: html`${e.siima_registered_at ? postButton(`/exames/${id}/siima-registado/desfazer`, 'desfazer', { kind: 'link', back }) : ''}${e.status === 'realizado' && !e.siima_registered_at ? postButton(`/exames/${id}/siima-registado`, 'Executado no Siima', { kind: 'owed', back }) : ''}`,
    };
    // Cada estação: quando aconteceu e o botão que a faz avançar (ou desfaz).
    const stopInfo = source === 'secretariado'
      ? [{ meta: e.confirmed_at ? fmtUtcLocal(e.confirmed_at) : e.status === 'pendente' ? 'reserva por confirmar' : e.status === 'recusado' ? 'recusada' : '', act: '' }, performed, report, executed]
      : [
        { meta: slotMeta, act: html`${can('agendar') ? html`<a class="btn primary" href="/exames/${id}/agendar">Agendar</a>` : ''}${can('reagendar') ? html`<a class="btn" href="/exames/${id}/agendar">Reagendar</a>` : ''}` },
        { meta: e.siima_booked_at ? fmtUtcLocal(e.siima_booked_at) : '',
          act: e.siima_booked_at ? postButton(`/exames/${id}/siima-marcado/desfazer`, 'desfazer', { kind: 'link', back })
            : ['agendado', 'realizado'].includes(e.status) ? postButton(`/exames/${id}/siima-marcado`, 'Marcado no Siima', { kind: 'owed', back }) : '' },
        performed, report, executed,
      ];
    const secondary = html`${source === 'secretariado' && can('reagendar') ? html`<a class="btn" href="/exames/${id}/agendar">Mudar a hora</a>` : ''}
      ${can('desmarcar') ? postButton(`/exames/${id}/desmarcar`, 'Desmarcar', { back, confirm: 'Remover a marcação? (lembre-se de desmarcar também no Siima)' }) : ''}
      ${can('anular_realizado') && !e.siima_registered_at ? postButton(`/exames/${id}/anular_realizado`, 'Anular «realizado»', { back, confirm: 'Voltar a pôr o exame como agendado?' }) : ''}
      ${can('cancelar') ? postButton(`/exames/${id}/cancelar`, 'Cancelar exame', { kind: 'danger', back, confirm: source === 'secretariado' ? 'Cancelar este exame? O secretariado vê a reserva como cancelada.' : 'Cancelar este exame?' }) : ''}`;
    const needsId = !e.patient_process && !e.patient_name && e.status === 'realizado';

    return send(reply, req, {
      title: e.type_name,
      active: source === 'direto' ? 'pedidos' : 'agenda',
      body: html`${pageHead(e.type_name, {
          back: source === 'direto' ? { href: `/pedidos/${e.request_id}`, label: html`Pedido <span class="mono">#${e.request_id}</span>` } : { href: '/hoje', label: 'Hoje' },
          sub: html`${e.starts_at ? html`<span class="sub-when">${cap(fmtDateLong(e.starts_at.slice(0, 10)))} · <span class="mono">${e.starts_at.slice(11)}</span></span>` : ''}${patientLabel(e)}${originTag(e.origin, e.project)}<span class="track-wrap tone-${t.tone}"><span class="track-label">${t.summary}</span></span>`,
        })}
        ${flash(req.query, req)}
        ${e.status === 'pendente' || e.change_kind ? html`<section class="sec inbox" id="confirmar"><div class="sec-h"><h2>${e.change_kind ? 'Pedido do secretariado' : 'Reserva por confirmar'}</h2></div>
          <ul class="list">${inboxItem(e, back, { compact: true, openRefuse: Number(req.query.recusar) || null })}</ul></section>` : ''}
        ${e.status === 'recusado' && e.decision_note ? html`<div class="notice warn"><p>Recusada: ${e.decision_note}</p></div>` : ''}
        <section class="sec" aria-label="Percurso do exame">
          <p class="route-src">${SOURCE_LABEL[source]}${source === 'secretariado' && e.booked_by_name ? html` · reservado por <b>${e.booked_by_name}</b>` : ''}</p>
          <ol class="route n${t.stations.length}">${t.stations.map((st, i) => html`<li class="stop ${t.states[i]}">
            <div class="stop-l">${st.label}</div>
            ${stopInfo[i].meta ? html`<div class="stop-m">${stopInfo[i].meta}</div>` : ''}
            <span class="sr">${STATE_SR[t.states[i]]}</span>
            ${String(stopInfo[i].act).trim() ? html`<div class="stop-a">${stopInfo[i].act}</div>` : ''}
          </li>`)}</ol>
          ${String(secondary).trim() ? html`<div class="more-actions"><span class="lead">Outras ações</span>${secondary}</div>` : ''}
        </section>
        <div class="two-col">
          <section class="sec quiet">
            <div class="sec-h"><h2>Dados</h2></div>
            <dl class="facts">
              <div><dt>Data</dt><dd>${when(e)}${e.ends_at ? `–${e.ends_at.slice(11)}` : ''}</dd></div>
              <div><dt>Duração</dt><dd>${e.minutes} min</dd></div>
              <div><dt>Requisição</dt><dd>${e.requisition ? copyable(e.requisition, 'requisição') : html`<span class="owed-txt">sem requisição</span>`}</dd></div>
              <div><dt>Processo</dt><dd>${copyable(e.patient_process, 'processo')}</dd></div>
              <div><dt>Origem</dt><dd>${ORIGIN_LABEL[e.origin]}${e.project ? ` — ${e.project}` : ''}</dd></div>
              ${e.referrer ? html`<div><dt>Requisitante</dt><dd>${e.referrer}</dd></div>` : ''}
            </dl>
            ${e.notes ? html`<h3 class="day-label">Notas do pedido</h3><p class="notes">${e.notes}</p>` : ''}
            ${!['cancelado', 'recusado'].includes(e.status) ? html`<details class="edit-box"${e.requisition ? '' : raw(' open')}><summary>${e.requisition ? 'Alterar n.º de requisição' : 'Indicar n.º de requisição'}</summary>
              <form method="post" action="/exames/${id}/requisicao" class="toolbar inline-edit">
              <label><span class="sr">N.º de requisição</span><input name="requisition" maxlength="40" value="${e.requisition}" class="mono" autocomplete="off" placeholder="n.º de requisição"></label><button class="btn" type="submit">Guardar</button></form></details>` : ''}
            <details class="edit-box"${needsId ? raw(' open') : ''}><summary>${needsId ? 'Identificar o doente (necessário para o relatório)' : 'Corrigir identificação do doente'}</summary>
              <form method="post" action="/pedidos/${e.request_id}/doente" class="stack">
                <input type="hidden" name="back" value="${back}">
                <div class="grid3">
                  <label>N.º de processo<input name="patient_process" maxlength="40" value="${e.patient_process}" class="mono" inputmode="numeric" autocomplete="off"></label>
                  <label>Nome <span class="opt">opcional</span><input name="patient_name" maxlength="120" value="${e.patient_name}" autocomplete="off"></label>
                  <label>Nascimento <span class="opt">opcional</span>${dateInput('birth_date', e.birth_date || '')}</label>
                </div>
                <div class="grid3">
                  <label>Origem<select name="origin">${Object.entries(ORIGIN_LABEL).map(([k, l]) => html`<option value="${k}"${e.origin === k ? raw(' selected') : ''}>${l}</option>`)}</select></label>
                  <label class="span2">Projeto / estudo <span class="opt">se não for externo</span><input name="project" maxlength="120" value="${e.project}"></label>
                </div>
                <div><button class="btn primary" type="submit">Guardar identificação</button></div>
              </form></details>
          </section>
          <section class="sec quiet">
            <div class="sec-h"><h2>Histórico</h2></div>
            ${log.length ? html`<ul class="log">${log.map((l) => {
              const d = l.detail ? JSON.parse(l.detail) : {};
              return html`<li><time>${fmtUtcLocal(l.at)}</time><span>${l.action.replace(/_/g, ' ')} · ${l.display_name || d.por || '—'}${d.motivo ? html` <span class="muted">(${d.motivo})</span>` : ''}</span></li>`;
            })}</ul>` : emptyState('Sem registos.')}
          </section>
        </div>`,
    });
  });

  app.get('/exames/:id/agendar', async (req, reply) => {
    const id = idParam(req);
    const e = id && getExam(db, id);
    if (!e) return reply.callNotFound();
    if (!['por_agendar', 'agendado', 'pendente'].includes(e.status)) return reply.redirect(`/exames/${id}?err=estado`);
    const today = todayLocal();
    const weeks = getSetting(db, 'horizon_weeks');
    const days = weeks * 7;
    const ctx = scheduleContext(db, today, addDays(today, days));
    const slots = freeSlots({ fromDate: today, days, minutes: e.minutes, typeId: e.exam_type_id, ...ctx, now: nowLocal(), ignoreExamId: e.id });
    const withTimes = slots.filter((d) => d.times.length);
    const direct = sourceOf(e) === 'direto';
    return send(reply, req, {
      title: 'Agendar',
      active: direct ? 'pedidos' : 'agenda',
      body: html`${pageHead(html`${e.status === 'por_agendar' ? 'Escolher hora' : 'Mudar a hora'}`, { back: { href: `/exames/${id}`, label: e.type_name } })}
        ${flash(req.query, req)}
        <div class="ctx"><span class="ex-title">${e.type_name}</span><span>${patientLabel(e)}</span>${originTag(e.origin, e.project)}
          <span class="muted">ocupa <strong>${roundUp(e.minutes, ctx.step)} min</strong>${ctx.maxPerDay[e.exam_type_id] ? ` · máx. ${ctx.maxPerDay[e.exam_type_id]} por dia` : ''}</span></div>
        ${e.starts_at ? html`<div class="notice warn"><p>Está marcado para <strong>${when(e)}</strong>.${direct ? ' Ao escolher outra hora, desmarque também a antiga no Siima.' : ' O secretariado vê a nova hora no link de reservas; a marcação no Siima é com elas.'}</p></div>` : ''}
        ${withTimes.length ? html`<form method="post" action="/exames/${id}/agendar">
          <div class="sec-note">Toque numa hora para marcar. ${help(`Só aparecem vagas livres nas próximas ${weeks} semanas (alterável em Administração → Horário).`)}</div>
          <div class="slot-days">${withTimes.map((d) => html`<section class="slot-day"><h2>${cap(fmtDateLong(d.date))} <span class="muted">${fmtDate(d.date)}</span></h2>
            ${slotGroups(d.times, ctx.availability, d.date, (time) => html`<button class="slot" type="submit" name="starts_at" value="${d.date}T${time}" aria-label="${fmtDateLong(d.date)} às ${time}">${time}</button>`)}</section>`)}</div>
        </form>` : html`<p class="empty">Não há vagas nas próximas ${weeks} semanas para um exame de ${roundUp(e.minutes, ctx.step)} min. Pode alargar o horário em <a href="/admin">Administração</a> ou remover <a href="/bloqueios">bloqueios</a>.</p>`}`,
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
    if (sourceOf(e) === 'secretariado') return reply.redirect(`/exames/${id}?msg=reagendado`);
    // Volta ao pedido se ainda houver exames por agendar; senão, ao início.
    const pending = db.prepare("SELECT COUNT(*) FROM exams WHERE request_id = ? AND status = 'por_agendar'").pluck().get(e.request_id);
    const msg = res.action === 'reagendar' ? 'reagendado_siima' : 'agendado';
    return reply.redirect(pending ? `/pedidos/${e.request_id}?msg=${msg}` : `/hoje?msg=${msg}`);
  });

  for (const action of ['desmarcar', 'cancelar', 'realizado', 'faltou', 'anular_realizado', 'recusar']) {
    app.post(`/exames/:id/${action}`, async (req, reply) => {
      const id = idParam(req);
      if (!id) return reply.callNotFound();
      const back = safeBack(req.body?.back, `/exames/${id}`);
      const res = transitionExam(db, req.user, id, action, { note: str(req.body?.note).trim() });
      return reply.redirect(res.ok ? withMsg(back, ACTION_MSG[action], id) : withParam(back, 'err', res.reason));
    });
  }

  app.post('/exames/:id/confirmar', async (req, reply) => {
    const id = idParam(req);
    if (!id) return reply.callNotFound();
    const back = safeBack(req.body?.back, `/exames/${id}`);
    const res = confirmReservation(db, req.user, id, str(req.body?.requisition));
    return reply.redirect(res.ok ? withMsg(back, 'confirmado', id) : withParam(back, 'err', res.reason));
  });

  for (const [path, accept] of [['aceitar', true], ['recusar', false]]) {
    app.post(`/exames/:id/alteracao/${path}`, async (req, reply) => {
      const id = idParam(req);
      if (!id) return reply.callNotFound();
      const back = safeBack(req.body?.back, `/exames/${id}`);
      const res = decideChange(db, req.user, id, accept, str(req.body?.note).trim());
      const msg = !accept ? 'alteracao_recusada' : res.kind === 'cancelar' ? 'cancelamento_aceite' : 'alteracao_aceite';
      return reply.redirect(res.ok ? withMsg(back, msg, id) : withParam(back, 'err', res.reason));
    });
  }

  app.post('/exames/:id/requisicao', async (req, reply) => {
    const id = idParam(req);
    if (!id) return reply.callNotFound();
    const res = setRequisition(db, { userId: req.user.id }, id, str(req.body?.requisition));
    return reply.redirect(`/exames/${id}?${res.ok ? 'msg=requisicao' : 'err=estado'}`);
  });

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

/** Horas livres de um dia agrupadas em Manhã / Tarde (segundo as janelas do horário). */
export function slotGroups(times, availability, date, button) {
  const wd = weekday(date);
  const ws = availability.filter((w) => w.weekday === wd).sort((a, b) => a.start.localeCompare(b.start));
  const groups = ws.map((w) => ({ w, times: times.filter((t) => t >= w.start && t < w.end) })).filter((g) => g.times.length);
  // Com manhã e tarde no horário, o rótulo aparece sempre (mesmo que só um dos períodos tenha vagas).
  if (ws.length <= 1) return html`<div class="slot-times">${times.map(button)}</div>`;
  return html`${groups.map((g) => html`<div class="slot-period"><h3>${g.w.start < '13:00' ? 'Manhã' : 'Tarde'}</h3><div class="slot-times">${g.times.map(button)}</div></div>`)}`;
}
