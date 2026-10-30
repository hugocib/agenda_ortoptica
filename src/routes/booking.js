// Link de reservas do secretariado: sem conta, sem dados de doentes. Mostra as vagas livres para
// um tipo de exame, cria reservas «por confirmar» e deixa pedir alterações ou cancelamentos.
// O link é secreto e pode ser gerado de novo em Administração (o anterior deixa de funcionar).
import crypto from 'node:crypto';
import { html, raw } from '../html.js';
import { getSetting } from '../db.js';
import { buildRequisitionPdf } from '../requisition.js';
import { getExam, examsWhere, listExamTypes, requestCancel, requestMove, reserve, scheduleContext, setRequisition, withdrawChange } from '../repo.js';
import { freeSlots, roundUp } from '../domain/slots.js';
import { notify } from '../push.js';
import { addDays, fmtDate, fmtDateLong, fmtUtcLocal, isDate, isLocalDateTime, mondayOf, nowLocal, todayLocal } from '../time.js';
import { cap, emptyState, flash, icon, pageHead, postButton } from '../ui.js';
import { readCookie } from '../auth.js';
import { idParam, send, str, withMsg, withParam } from './util.js';
import { slotGroups } from './exams.js';

function tokenOk(db, token) {
  const a = Buffer.from(String(token));
  const b = Buffer.from(String(getSetting(db, 'booking_token') || ''));
  return a.length === b.length && b.length > 0 && crypto.timingSafeEqual(a, b);
}

const shortWhen = (ldt) => `${cap(fmtDateLong(ldt.slice(0, 10)).split(',')[0])} ${fmtDate(ldt).slice(0, 5)}, ${ldt.slice(11)}`;

/** Estado tal como o secretariado o precisa de ver. */
function statusFor(e) {
  if (e.change_kind === 'mover') return { cls: 'owed', text: html`Pediu mudança para <b>${shortWhen(e.change_starts_at)}</b> — à espera de resposta` };
  if (e.change_kind === 'cancelar') return { cls: 'owed', text: 'Pediu cancelamento — à espera de resposta' };
  switch (e.status) {
    case 'pendente': return { cls: 'owed', text: 'Por confirmar' };
    case 'agendado': return e.decision_note
      ? { cls: 'ok', text: html`Confirmado · o pedido de alteração foi recusado: ${e.decision_note}` }
      : { cls: 'ok', text: 'Confirmado' };
    case 'recusado': return { cls: 'late', text: html`Recusado${e.decision_note ? html`: ${e.decision_note}` : ''}` };
    case 'cancelado': return { cls: 'muted', text: 'Cancelado' };
    case 'realizado': return { cls: 'muted', text: 'Realizado' };
    case 'faltou': return { cls: 'muted', text: 'Faltou' };
    default: return { cls: 'muted', text: e.status };
  }
}

function weekNav(base, monday, first, last, extra = '') {
  const prev = addDays(monday, -7);
  const next = addDays(monday, 7);
  return html`<nav class="week-nav" aria-label="Semana">
    ${prev >= first ? html`<a class="btn ghost" href="${base}semana=${prev}${extra}" aria-label="Semana anterior">${icon('esq', 'ico sm')}</a>` : html`<span class="btn ghost" aria-disabled="true">${icon('esq', 'ico sm')}</span>`}
    <span class="range">${fmtDate(monday).slice(0, 5)} – ${fmtDate(addDays(monday, 6))}</span>
    ${next <= last ? html`<a class="btn ghost" href="${base}semana=${next}${extra}" aria-label="Semana seguinte">${icon('dir', 'ico sm')}</a>` : html`<span class="btn ghost" aria-disabled="true">${icon('dir', 'ico sm')}</span>`}
  </nav>`;
}

/** Vagas livres de uma semana para um exame com `minutes` (e, ao mudar, ignorando o próprio). */
function weekSlots(db, { monday, minutes, typeId, ignoreExamId = null }) {
  const today = todayLocal();
  const horizonEnd = addDays(today, getSetting(db, 'horizon_weeks') * 7);
  const from = monday < today ? today : monday;
  const to = addDays(monday, 7) < horizonEnd ? addDays(monday, 7) : horizonEnd;
  if (from >= to) return { days: [], ctx: null };
  const ctx = scheduleContext(db, from, to);
  const days = freeSlots({ fromDate: from, days: Math.round((Date.parse(to) - Date.parse(from)) / 86400000), minutes, typeId, ...ctx, now: nowLocal(), ignoreExamId })
    .filter((d) => d.times.length);
  return { days, ctx };
}

/**
 * Vagas como escolha (rádio), não como envio: tocar numa hora só a seleciona. A reserva só é
 * feita no botão da barra de confirmação, que mostra o resumo do que vai ser enviado.
 */
function slotPicker(days, availability, { exam, submit }) {
  if (!days.length) return html`<p class="empty">Sem vagas para este exame nesta semana. Experimente a semana seguinte.</p>`;
  let first = true;
  const radio = (d, t) => {
    const req = first ? raw(' required') : '';
    first = false;
    return html`<label class="slot slot-pick"><input type="radio" name="start" value="${d.date}T${t}"${req} data-label="${fmtDateLong(d.date)} às ${t}"><span>${t}</span></label>`;
  };
  return html`<fieldset class="slot-fs"><legend class="sr">Escolha a hora</legend><div class="slot-days">${days.map((d) => html`<section class="slot-day"><h2>${cap(fmtDateLong(d.date))} <span class="muted">${fmtDate(d.date)}</span></h2>
    ${slotGroups(d.times, availability, d.date, (t) => radio(d, t))}</section>`)}</div></fieldset>
    <div class="confirm-bar" data-confirm-bar data-exam="${exam}">
      <p class="confirm-sum" data-summary aria-live="polite">Escolha uma hora.</p>
      <button class="btn primary big" type="submit">${submit}</button>
    </div>`;
}

function whoField(names, chosen) {
  if (names.length) {
    return html`<label>Quem reserva *<select name="quem" required><option value="">Escolha…</option>${names.map((n) => html`<option${n === chosen ? raw(' selected') : ''}>${n}</option>`)}</select></label>`;
  }
  return html`<label>Quem reserva *<input name="quem" required maxlength="60" value="${chosen}" autocomplete="name"></label>`;
}

function validName(db, raw) {
  const v = String(raw || '').trim().slice(0, 60);
  const names = getSetting(db, 'booking_names') || [];
  if (names.length) return names.includes(v) ? v : '';
  return v.length >= 2 ? v : '';
}

const pushText = (e, start = e.starts_at) => `${e.type_name} · ${shortWhen(start)}`;

export default async function bookingRoutes(app, { db }) {
  // Todas as rotas /r/:token/* validam o link antes de tudo.
  app.addHook('preHandler', async (req, reply) => {
    const m = req.url.match(/^\/r\/([^/?#]+)/);
    if (!m) return;
    if (!tokenOk(db, decodeURIComponent(m[1]))) {
      return send(reply, req, {
        title: 'Link inválido', bare: true,
        body: html`<div class="gate"><h1>Link de reservas inválido</h1><p class="lede">Este endereço já não está ativo. Peça o link novo ao ortoptista.</p></div>`,
      }, 404);
    }
  });

  const ping = (req, msg) => { notify(db, msg, { log: req.log }).catch(() => {}); };

  app.get('/r/:token', async (req, reply) => {
    const token = req.params.token;
    const base = `/r/${token}`;
    const today = todayLocal();
    const types = listExamTypes(db);
    const tipo = types.find((t) => String(t.id) === str(req.query.tipo)) || null;
    const first = mondayOf(today);
    const last = mondayOf(addDays(today, getSetting(db, 'horizon_weeks') * 7 - 1));
    let monday = mondayOf(isDate(str(req.query.semana)) ? str(req.query.semana) : today);
    if (monday < first) monday = first;
    if (monday > last) monday = last;
    const names = getSetting(db, 'booking_names') || [];
    const step = getSetting(db, 'slot_step_min');
    const chosen = decodeURIComponent(readCookie(req.headers.cookie, 'quem') || '');
    const { days, ctx } = tipo ? weekSlots(db, { monday, minutes: tipo.minutes, typeId: tipo.id }) : { days: [], ctx: null };
    const reservas = examsWhere(db, `r.source = 'secretariado' AND e.starts_at >= ? AND (e.status IN ('pendente','agendado') OR e.updated_at >= ?)`,
      [`${today}T00:00`, new Date(Date.now() - 14 * 86400000).toISOString()], 'e.starts_at', 300);

    return send(reply, req, {
      title: 'Reservas',
      pub: true,
      wide: true,
      autorefresh: 120,
      body: html`${pageHead('Reservar exame', { actions: html`<a class="btn" href="${base}/requisicao.pdf" download>Requisição em branco (PDF)</a>`, sub: 'Escolha o exame e depois a hora. Sem dados do doente.', info: html`<p>A reserva fica «por confirmar» até o ortoptista a confirmar; o estado aparece na lista de reservas.</p><p>Enquanto não estiver confirmada pode mudar a hora ou anular. Depois de confirmada, pode pedir uma alteração ou o cancelamento.</p>` })}
        ${flash(req.query, req)}
        <div class="book">
          <section class="sec book-new" aria-labelledby="h-nova">
            <div class="sec-h"><h2 id="h-nova">Nova reserva</h2></div>
            <form method="get" action="${base}" class="toolbar">
              <label>Exame <select name="tipo" data-autosubmit>${tipo ? '' : html`<option value="">Escolha o exame…</option>`}${types.map((t) => html`<option value="${t.id}"${tipo?.id === t.id ? raw(' selected') : ''}>${t.name} · ${roundUp(t.minutes, step)} min</option>`)}</select></label>
              <input type="hidden" name="semana" value="${monday}">
              <button class="btn" type="submit">Ver horas livres</button>
            </form>
            ${tipo ? html`<form method="post" action="${base}/reservar" class="guarded">
                <input type="hidden" name="tipo" value="${tipo.id}">
                <div class="form-grid book-who">
                  ${whoField(names, chosen)}
                  <label>N.º de requisição <span class="opt">opcional; pode pôr depois</span><input name="requisicao" maxlength="40" class="mono" autocomplete="off"></label>
                </div>
                <div class="book-week"><p class="sec-note">Escolha a hora e confirme em baixo (${tipo.name}: <b>${roundUp(tipo.minutes, step)} min</b>).</p>
                  ${weekNav(`${base}?tipo=${tipo.id}&`, monday, first, last)}</div>
                ${slotPicker(days, ctx?.availability || [], { exam: tipo.name, submit: 'Confirmar reserva' })}
              </form>` : html`<p class="empty">Escolha o tipo de exame para ver as horas livres.</p>`}
          </section>
          <section class="sec book-list" id="reservas" aria-labelledby="h-res">
            <div class="sec-h"><h2 id="h-res">Reservas</h2>${reservas.length ? html`<span class="count">${reservas.length}</span>` : ''}<span class="aside">a partir de hoje</span></div>
            ${reservas.length ? html`<ul class="list">${reservas.map((e) => {
              const st = statusFor(e);
              return html`<li class="res-i"><a class="res-link" href="${base}/reservas/${e.id}">
                <span class="when">${shortWhen(e.starts_at)}</span>
                <span class="ex-title">${e.type_name}</span>
                <span class="ex-meta">${e.requisition ? html`<span class="req"><span class="req-l">Req.</span> ${e.requisition}</span>` : html`<span class="owed-txt">sem requisição</span>`}<span class="by">${e.booked_by_name}</span></span>
                <span class="res-st st-${st.cls}">${st.text}</span></a></li>`;
            })}</ul>` : emptyState('Ainda não há reservas.')}
          </section>
        </div>`,
    });
  });

  // Impresso de requisição em branco, para enviar aos médicos (sem dados nenhuns).
  app.get('/r/:token/requisicao.pdf', async (req, reply) => {
    const pdf = await buildRequisitionPdf(db);
    return reply.type('application/pdf').header('Content-Disposition', 'attachment; filename="requisicao-exames-ortoptica.pdf"').header('Cache-Control', 'no-cache').send(Buffer.from(pdf));
  });

  app.post('/r/:token/reservar', async (req, reply) => {
    const base = `/r/${req.params.token}`;
    const b = req.body || {};
    const typeId = Number.parseInt(str(b.tipo), 10);
    const startsAt = str(b.start);
    const name = validName(db, b.quem);
    const back = `${base}?tipo=${typeId || ''}&semana=${isLocalDateTime(startsAt) ? mondayOf(startsAt.slice(0, 10)) : ''}`;
    if (!name) return reply.redirect(withParam(back, 'err', 'sem_nome'));
    if (!isLocalDateTime(startsAt) || !typeId) return reply.redirect(withParam(back, 'err', 'hora_invalida'));
    const res = reserve(db, { typeId, startsAt, requisition: str(b.requisicao), name });
    if (!res.ok) return reply.redirect(withParam(back, 'err', res.reason));
    reply.header('set-cookie', `quem=${encodeURIComponent(name)}; Path=/r/; Max-Age=${3600 * 24 * 400}; SameSite=Lax${req.protocol === 'https' ? '; Secure' : ''}`);
    const e = getExam(db, res.id);
    ping(req, { title: 'Nova reserva por confirmar', body: `${pushText(e)} · ${name}`, url: '/hoje#confirmar', tag: `exame-${e.id}` });
    return reply.redirect(`${base}/reservas/${res.id}?msg=reservado`);
  });

  const loadOwn = (req) => {
    const id = idParam(req);
    const e = id && getExam(db, id);
    return e && e.source === 'secretariado' ? e : null;
  };

  app.get('/r/:token/reservas/:id', async (req, reply) => {
    const e = loadOwn(req);
    if (!e) return reply.callNotFound();
    const base = `/r/${req.params.token}`;
    const here = `${base}/reservas/${e.id}`;
    const st = statusFor(e);
    const today = todayLocal();
    const future = e.starts_at > nowLocal();
    const canMove = !e.change_kind && future && ['pendente', 'agendado'].includes(e.status);
    const first = mondayOf(today);
    const last = mondayOf(addDays(today, getSetting(db, 'horizon_weeks') * 7 - 1));
    let monday = mondayOf(isDate(str(req.query.semana)) ? str(req.query.semana) : e.starts_at.slice(0, 10));
    if (monday < first) monday = first;
    if (monday > last) monday = last;
    const { days, ctx } = canMove ? weekSlots(db, { monday, minutes: e.minutes, typeId: e.exam_type_id, ignoreExamId: e.id }) : { days: [], ctx: null };
    const names = getSetting(db, 'booking_names') || [];
    const chosen = decodeURIComponent(readCookie(req.headers.cookie, 'quem') || '');
    const pending = e.status === 'pendente';
    const history = db.prepare("SELECT at, action, detail FROM audit_log WHERE entity = 'exame' AND entity_id = ? ORDER BY id").all(e.id);
    const LABEL = { reservar: 'Reservado', mudar_reserva: 'Hora mudada', pedir_alteracao: 'Pedida alteração', pedir_cancelamento: 'Pedido cancelamento', anular_reserva: 'Anulada', retirar_pedido: 'Pedido retirado', confirmar: 'Confirmado pelo ortoptista', recusar: 'Recusado pelo ortoptista', aceitar_alteracao: 'Alteração aceite', recusar_alteracao: 'Alteração recusada', reagendar: 'Hora mudada pelo ortoptista', cancelar: 'Cancelado pelo ortoptista', requisicao: 'Requisição atualizada', realizado: 'Realizado', faltou: 'Faltou' };

    return send(reply, req, {
      title: 'Reserva',
      pub: true,
      body: html`${pageHead(e.type_name, {
          back: { href: `${base}#reservas`, label: 'Reservas' },
          sub: html`<span class="when">${cap(fmtDateLong(e.starts_at.slice(0, 10)))} · ${e.starts_at.slice(11)}–${e.ends_at.slice(11)}</span><span class="by">reservado por ${e.booked_by_name}</span>`,
        })}
        ${flash(req.query, req)}
        <p class="res-st big st-${st.cls}">${st.text}</p>
        ${!['cancelado', 'recusado', 'realizado', 'faltou'].includes(e.status) ? html`<section class="sec"><div class="sec-h"><h2>N.º de requisição</h2></div>
          <form method="post" action="${here}/requisicao" class="toolbar">
            <label><span class="sr">N.º de requisição</span><input name="requisicao" maxlength="40" value="${e.requisition}" class="mono" autocomplete="off" placeholder="ainda sem requisição"></label>
            <button class="btn${e.requisition ? '' : ' primary'}" type="submit">Guardar</button>
          </form>
          ${pending && !e.requisition ? html`<p class="sec-note">O ortoptista precisa do n.º de requisição para confirmar.</p>` : ''}</section>` : ''}
        ${e.change_kind ? html`<section class="sec"><div class="sec-h"><h2>Pedido em curso</h2></div>
          <p>${e.change_kind === 'mover' ? html`Pediu para mudar para <b>${shortWhen(e.change_starts_at)}</b>. Essa hora fica reservada até o ortoptista responder; até lá, mantém-se a hora atual.` : 'Pediu o cancelamento. Até o ortoptista responder, a reserva mantém-se.'}</p>
          ${postButton(`${here}/retirar`, 'Retirar o pedido', { confirm: 'Retirar este pedido? A reserva fica como estava.' })}</section>` : ''}
        ${canMove ? html`<section class="sec"><div class="sec-h"><h2>${pending ? 'Mudar a hora' : 'Pedir outra hora'}</h2></div>
          <p class="sec-note">${pending ? 'Ainda não foi confirmada: a hora muda logo.' : 'Já está confirmada: o ortoptista tem de aceitar a mudança. A hora atual mantém-se até lá.'}</p>
          <form method="post" action="${here}/mover" class="guarded">
            <div class="form-grid book-who">${whoField(names, chosen)}</div>
            <div class="book-week">${weekNav(`${here}?`, monday, first, last)}</div>
            ${slotPicker(days, ctx?.availability || [], { exam: e.type_name, submit: pending ? 'Confirmar nova hora' : 'Enviar pedido de alteração' })}
          </form></section>
          <section class="sec"><div class="sec-h"><h2>${pending ? 'Anular' : 'Cancelar'}</h2></div>
            <form method="post" action="${here}/cancelar" class="toolbar">${whoField(names, chosen)}
              <button class="btn danger" type="submit" data-confirm="${pending ? 'Anular esta reserva? A vaga fica livre.' : 'Pedir o cancelamento desta reserva?'}">${pending ? 'Anular a reserva' : 'Pedir cancelamento'}</button></form></section>` : ''}
        <section class="sec quiet"><div class="sec-h"><h2>Histórico</h2></div>
          <ul class="log">${history.map((h) => { const d = h.detail ? JSON.parse(h.detail) : {}; return html`<li><time>${fmtUtcLocal(h.at)}</time><span>${LABEL[h.action] || h.action.replace(/_/g, ' ')}${d.por ? ` · ${d.por}` : ''}${d.motivo ? ` · ${d.motivo}` : ''}</span></li>`; })}</ul>
        </section>`,
    });
  });

  app.post('/r/:token/reservas/:id/requisicao', async (req, reply) => {
    const e = loadOwn(req);
    if (!e) return reply.callNotFound();
    const here = `/r/${req.params.token}/reservas/${e.id}`;
    const res = setRequisition(db, { name: decodeURIComponent(readCookie(req.headers.cookie, 'quem') || '') || 'secretariado' }, e.id, str(req.body?.requisicao));
    return reply.redirect(res.ok ? withMsg(here, 'requisicao') : withParam(here, 'err', 'estado'));
  });

  app.post('/r/:token/reservas/:id/mover', async (req, reply) => {
    const e = loadOwn(req);
    if (!e) return reply.callNotFound();
    const here = `/r/${req.params.token}/reservas/${e.id}`;
    const startsAt = str(req.body?.start);
    const name = validName(db, req.body?.quem);
    if (!name) return reply.redirect(withParam(here, 'err', 'sem_nome'));
    if (!isLocalDateTime(startsAt)) return reply.redirect(withParam(here, 'err', 'hora_invalida'));
    const res = requestMove(db, e.id, startsAt, name);
    if (!res.ok) return reply.redirect(withParam(here, 'err', res.reason));
    ping(req, res.direct
      ? { title: 'Reserva mudada de hora', body: `${e.type_name} · agora ${shortWhen(startsAt)} (era ${shortWhen(res.from)}) · ${name}`, url: '/hoje#confirmar', tag: `exame-${e.id}` }
      : { title: 'Pedido de alteração', body: `${e.type_name} · de ${shortWhen(res.from)} para ${shortWhen(startsAt)} · ${name}`, url: '/hoje#confirmar', tag: `exame-${e.id}` });
    return reply.redirect(withMsg(here, res.direct ? 'reserva_mudada' : 'pedido_alteracao'));
  });

  app.post('/r/:token/reservas/:id/cancelar', async (req, reply) => {
    const e = loadOwn(req);
    if (!e) return reply.callNotFound();
    const here = `/r/${req.params.token}/reservas/${e.id}`;
    const name = validName(db, req.body?.quem);
    if (!name) return reply.redirect(withParam(here, 'err', 'sem_nome'));
    const res = requestCancel(db, e.id, name);
    if (!res.ok) return reply.redirect(withParam(here, 'err', res.reason));
    ping(req, res.direct
      ? { title: 'Reserva anulada', body: `${pushText(e)} · ${name}`, url: '/agenda', tag: `exame-${e.id}` }
      : { title: 'Pedido de cancelamento', body: `${pushText(e)} · ${name}`, url: '/hoje#confirmar', tag: `exame-${e.id}` });
    return reply.redirect(withMsg(here, res.direct ? 'reserva_anulada' : 'pedido_cancelamento'));
  });

  app.post('/r/:token/reservas/:id/retirar', async (req, reply) => {
    const e = loadOwn(req);
    if (!e) return reply.callNotFound();
    const here = `/r/${req.params.token}/reservas/${e.id}`;
    const name = decodeURIComponent(readCookie(req.headers.cookie, 'quem') || '') || 'secretariado';
    const res = withdrawChange(db, e.id, name);
    if (res.ok) ping(req, { title: 'Pedido retirado', body: `${pushText(e)} · ${name}`, url: `/exames/${e.id}`, tag: `exame-${e.id}` });
    return reply.redirect(res.ok ? withMsg(here, 'pedido_retirado') : withParam(here, 'err', res.reason));
  });
}
