import { z } from 'zod';
import { html } from '../html.js';
import { audit } from '../db.js';
import { examsWhere } from '../repo.js';
import { addDays, fmtDate, fmtDateLong, fmtDateTime, isDate, isTime, mondayOf, nowLocal, toIsoDate, todayLocal } from '../time.js';
import { fmtDuration } from '../domain/tape.js';
import { cap, dateInput, dayTapeByPeriod, emptyState, examLine, flash, icon, pageHead, postButton, timeSelect } from '../ui.js';
import { dayData } from './today.js';
import { idParam, send, str } from './util.js';

const BlockSchema = z.object({
  date_from: z.string().refine(isDate, 'Data inicial inválida.'),
  date_to: z.string().refine((v) => v === '' || isDate(v), 'Data final inválida.'),
  time_from: z.string().refine((v) => v === '' || isTime(v), 'Hora inválida.'),
  time_to: z.string().refine((v) => v === '' || isTime(v), 'Hora inválida.'),
  reason: z.string().trim().min(1, 'Indique o motivo.').max(120),
});

/** «03/11/2026 · dia inteiro», «03/11 – 07/11/2026 · dias inteiros» ou «03/11/2026 09:00–10:30». */
function blockPeriod(b) {
  const [d1, t1] = [b.starts_at.slice(0, 10), b.starts_at.slice(11)];
  const [d2, t2] = [b.ends_at.slice(0, 10), b.ends_at.slice(11)];
  if (t1 === '00:00' && t2 === '00:00') {
    const last = addDays(d2, -1);
    return last === d1 ? `${fmtDate(d1)} · dia inteiro` : `${fmtDate(d1).slice(0, 5)} – ${fmtDate(last)} · dias inteiros`;
  }
  if (d1 === d2) return `${fmtDate(d1)} ${t1}–${t2}`;
  return `${fmtDateTime(b.starts_at)} → ${fmtDateTime(b.ends_at)}`;
}

export default async function agendaRoutes(app, { db }) {
  app.get('/agenda', async (req, reply) => {
    const today = todayLocal();
    const monday = mondayOf(isDate(str(req.query.semana)) ? str(req.query.semana) : today);
    const sunday = addDays(monday, 7);
    const exams = examsWhere(db, "e.status IN ('pendente','agendado','realizado','faltou') AND e.starts_at >= ? AND e.starts_at < ?", [`${monday}T00:00`, `${sunday}T00:00`]);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(monday, i);
      const dayExams = exams.filter((e) => e.starts_at.startsWith(date));
      const { t, windows } = dayData(db, date, { exams: dayExams, nowTime: date === today ? nowLocal().slice(11) : date < today ? '24:00' : null });
      if (!windows.length && !t.items.length) continue;
      days.push({ date, windows, dayExams, t });
    }
    const sundayLast = addDays(monday, 6);
    const isThisWeek = monday === mondayOf(today);

    return send(reply, req, {
      title: 'Agenda',
      active: 'agenda',
      wide: true,
      body: html`${pageHead('Agenda', {
          sub: html`<nav class="week-nav" aria-label="Semana">
            <a class="btn ghost" href="/agenda?semana=${addDays(monday, -7)}" aria-label="Semana anterior">${icon('esq', 'ico sm')}</a>
            <span class="range">${fmtDate(monday).slice(0, 5)} – ${fmtDate(sundayLast)}</span>
            <a class="btn ghost" href="/agenda?semana=${addDays(monday, 7)}" aria-label="Semana seguinte">${icon('dir', 'ico sm')}</a>
            ${isThisWeek ? '' : html`<a class="btn" href="/agenda">Esta semana</a>`}</nav>`,
          actions: html`<a class="btn" href="/bloqueios">Bloqueios</a>`,
        })}
        ${flash(req.query, req)}
        ${days.length ? html`<div class="week">${days.map((d) => html`<section class="day-col${d.date === today ? ' today' : ''}" aria-label="${fmtDateLong(d.date)}">
          <div class="sec-h"><h2>${cap(fmtDateLong(d.date))}</h2>
            <span class="aside">${!d.windows.length ? 'fora do horário' : d.date < today ? 'já passou' : d.t.freeMinutes ? html`<span class="free">${fmtDuration(d.t.freeMinutes)} livre</span>` : 'sem vagas'}</span></div>
          ${dayTapeByPeriod(d.t, d.windows, (e) => html`<div class="t-body">${examLine(e, { today })}</div>`, { holdHref: (e) => `/exames/${e.id}` })}
        </section>`)}</div>` : emptyState('Sem horário de exames nesta semana.')}`,
    });
  });

  app.get('/bloqueios', async (req, reply) => {
    const today = todayLocal();
    const blocks = db.prepare(`SELECT b.*, u.display_name FROM blocks b JOIN users u ON u.id = b.created_by
      WHERE b.ends_at >= ? ORDER BY b.starts_at LIMIT 200`).all(`${today}T00:00`);
    return send(reply, req, {
      title: 'Bloqueios',
      active: 'agenda',
      body: html`${pageHead('Bloqueios', { back: { href: '/agenda', label: 'Agenda' }, info: 'Férias, formação, MEG, reuniões: períodos sem vagas. Os exames já marcados nesse período não mudam.' })}
        ${flash(req.query, req)}
        <form method="post" action="/bloqueios" class="sheet form-grid">
          <label>De *${dateInput('date_from', today, { required: true })}</label>
          <label>Até <span class="opt">vazio = mesmo dia</span>${dateInput('date_to', '')}</label>
          <label>Hora inicial <span class="opt">«—» = dia inteiro</span>${timeSelect('time_from', '', { from: '07:00', to: '21:00' })}</label>
          <label>Hora final${timeSelect('time_to', '', { from: '07:00', to: '21:00' })}</label>
          <label class="span2">Motivo *<input name="reason" required maxlength="120" placeholder="p. ex. Férias, Formação MEG"></label>
          <div class="span2 form-actions"><button class="btn primary" type="submit">Bloquear período</button></div>
        </form>
        <section class="sec">
          <div class="sec-h"><h2>Próximos bloqueios</h2>${blocks.length ? html`<span class="count">${blocks.length}</span>` : ''}</div>
          ${blocks.length ? html`<table class="table rt"><thead><tr><th>Período</th><th>Motivo</th><th>Criado por</th><th></th></tr></thead>
            <tbody>${blocks.map((b) => html`<tr><td class="main-cell"><span class="when">${blockPeriod(b)}</span></td><td>${b.reason}</td><td class="muted">${b.display_name}</td>
            <td class="right act">${postButton(`/bloqueios/${b.id}/apagar`, 'Remover', { kind: 'link', confirm: 'Remover este bloqueio?' })}</td></tr>`)}</tbody></table>`
            : emptyState('Sem bloqueios futuros.')}
        </section>`,
    });
  });

  app.post('/bloqueios', async (req, reply) => {
    const b = req.body || {};
    const parsed = BlockSchema.safeParse({ date_from: toIsoDate(str(b.date_from)), date_to: toIsoDate(str(b.date_to)), time_from: str(b.time_from), time_to: str(b.time_to), reason: str(b.reason) });
    if (!parsed.success) return reply.redirect('/bloqueios?err=hora_invalida');
    const v = parsed.data;
    const dateTo = v.date_to || v.date_from;
    const startsAt = `${v.date_from}T${v.time_from || '00:00'}`;
    // Dia inteiro: termina às 00:00 do dia seguinte.
    const endsAt = v.time_to ? `${dateTo}T${v.time_to}` : `${addDays(dateTo, 1)}T00:00`;
    if (endsAt <= startsAt) return reply.redirect('/bloqueios?err=hora_invalida');
    const info = db.prepare('INSERT INTO blocks (starts_at, ends_at, reason, created_by) VALUES (?, ?, ?, ?)').run(startsAt, endsAt, v.reason, req.user.id);
    audit(db, req.user.id, 'criar', 'bloqueio', Number(info.lastInsertRowid), { startsAt, endsAt });
    return reply.redirect('/bloqueios?msg=bloqueio');
  });

  app.post('/bloqueios/:id/apagar', async (req, reply) => {
    const id = idParam(req);
    if (!id) return reply.callNotFound();
    const res = db.prepare('DELETE FROM blocks WHERE id = ?').run(id);
    if (res.changes) audit(db, req.user.id, 'apagar', 'bloqueio', id);
    return reply.redirect('/bloqueios?msg=bloqueio_apagado');
  });
}
