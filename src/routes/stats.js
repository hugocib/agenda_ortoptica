// Estatística de execução: quanto se fez, quanto faltou, como se usou a agenda e quanto tempo
// demora cada passo. Sem valores financeiros (a faturação é do secretariado).
import { html, raw } from '../html.js';
import { emptyState, pageHead } from '../ui.js';
import { getSetting } from '../db.js';
import { capacityMinutes } from '../domain/slots.js';
import { ORIGIN_LABEL, SOURCE_LABEL, STATUS_LABEL } from '../domain/status.js';
import { addDays, monthName, todayLocal } from '../time.js';
import { forbid, isOrtho, send, str } from './util.js';

const pad = (n) => String(n).padStart(2, '0');

function range(year, month) {
  if (month) {
    const from = `${year}-${pad(month)}-01`;
    const to = month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;
    return { from, to };
  }
  return { from: `${year}-01-01`, to: `${year + 1}-01-01` };
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
const fmtDays = (d) => (d === null ? '—' : d < 1 ? '< 1 dia' : `${Math.round(d)} ${Math.round(d) === 1 ? 'dia' : 'dias'}`);

export function computeStats(db, year, month) {
  const { from, to } = range(year, month);
  const rows = db.prepare(`SELECT e.*, t.name AS type_name, t.sort, r.origin, r.source, r.project, rp.status AS report_status, rp.validated_at
    FROM exams e JOIN exam_types t ON t.id = e.exam_type_id JOIN requests r ON r.id = e.request_id LEFT JOIN reports rp ON rp.exam_id = e.id
    WHERE e.starts_at >= ? AND e.starts_at < ?`).all(`${from}T00:00`, `${to}T00:00`);
  const byType = new Map();
  const blank = () => ({ realizados: 0, faltas: 0, agendados: 0, cancelados: 0, recusados: 0, executados: 0, porExecutar: 0, relatorios: 0, minutos: 0 });
  const totals = blank();
  const wait = [];
  const toReport = [];
  const toSiima = [];
  const bySource = { secretariado: 0, direto: 0 };
  const byOrigin = {};
  const projects = new Map();
  for (const e of rows) {
    if (!byType.has(e.type_name)) byType.set(e.type_name, { name: e.type_name, sort: e.sort, ...blank() });
    const t = byType.get(e.type_name);
    const inc = (k, n = 1) => { t[k] += n; totals[k] += n; };
    if (e.status === 'realizado') {
      inc('realizados'); inc('minutos', e.minutes);
      if (e.siima_registered_at) { inc('executados'); toSiima.push(days(`${e.starts_at}:00`, e.siima_registered_at)); } else inc('porExecutar');
      if (e.report_status === 'validado') { inc('relatorios'); if (e.validated_at) toReport.push(days(`${e.starts_at}:00`, e.validated_at)); }
      // Espera: do pedido/reserva até ao dia do exame.
      wait.push(days(e.created_at, `${e.starts_at}:00`));
      bySource[e.source === 'secretariado' ? 'secretariado' : 'direto']++;
      byOrigin[e.origin] = (byOrigin[e.origin] || 0) + 1;
      if (e.origin !== 'externo') projects.set(e.project || '—', (projects.get(e.project || '—') || 0) + 1);
    } else if (e.status === 'faltou') inc('faltas');
    else if (e.status === 'agendado' || e.status === 'pendente') inc('agendados');
    else if (e.status === 'cancelado') inc('cancelados');
    else if (e.status === 'recusado') inc('recusados');
  }
  // Ocupação: só o período já decorrido e desde que a app começou a ser usada; senão um ano
  // inteiro com 2 meses de uso daria uma percentagem enganadora.
  const firstUse = db.prepare('SELECT MIN(substr(starts_at, 1, 10)) FROM exams WHERE starts_at IS NOT NULL').pluck().get();
  const capFrom = firstUse && firstUse > from ? firstUse : from;
  const tomorrow = addDays(todayLocal(), 1);
  const capTo = tomorrow < to ? tomorrow : to;
  const capacity = capFrom < capTo ? capacityMinutes(getSetting(db, 'availability'), capFrom, capTo) : 0;
  return {
    from, to, rows, totals, capacity, bySource,
    byType: [...byType.values()].sort((a, b) => a.sort - b.sort),
    byOrigin: Object.entries(byOrigin).map(([origin, n]) => ({ origin, n })).sort((a, b) => b.n - a.n),
    projects: [...projects.entries()].map(([project, n]) => ({ project, n })).sort((a, b) => b.n - a.n),
    medians: { wait: median(wait), report: median(toReport), siima: median(toSiima) },
  };
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // Evita injeção de fórmulas no Excel (=, +, -, @ no início).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export default async function statsRoutes(app, { db }) {
  app.get('/estatistica', async (req, reply) => {
    if (!isOrtho(req)) return forbid(reply);
    const today = todayLocal();
    const year = Number.parseInt(str(req.query.ano), 10) || Number(today.slice(0, 4));
    const monthQ = Number.parseInt(str(req.query.mes), 10);
    const month = monthQ >= 1 && monthQ <= 12 ? monthQ : null;
    const s = computeStats(db, year, month);
    const t = s.totals;
    const label = month ? `${monthName(month)} de ${year}` : String(year);
    const months = [];
    if (!month) {
      for (let m = 1; m <= 12; m++) {
        const ms = computeStats(db, year, m);
        months.push({ m, ...ms.totals, capacity: ms.capacity });
      }
    }
    const maxM = Math.max(0, ...months.map((m) => m.realizados));
    const fechados = t.realizados + t.faltas;
    return send(reply, req, {
      title: 'Estatística',
      active: 'estatistica',
      body: html`${pageHead(html`Estatística <span class="muted">· ${label}</span>`, {
          actions: html`<a class="btn" href="/estatistica/exames.csv?ano=${year}${month ? `&mes=${month}` : ''}" download>Exportar CSV</a>`,
        })}
        <form method="get" action="/estatistica" class="toolbar" aria-label="Período">
          <label>Ano <input type="number" name="ano" value="${year}" min="2020" max="2100" class="num small-num"></label>
          <label>Mês <select name="mes"><option value="">Ano inteiro</option>${Array.from({ length: 12 }, (_, i) => html`<option value="${i + 1}"${month === i + 1 ? html` selected` : ''}>${monthName(i + 1)}</option>`)}</select></label>
          <button class="btn" type="submit">Ver</button>
          ${month ? html`<a href="/estatistica?ano=${year}">Ver o ano todo</a>` : ''}
        </form>
        <dl class="ledger">
          <div><dt>Exames realizados</dt><dd>${t.realizados}<small>${Math.round(t.minutos / 60)} h de exames</small></dd></div>
          <div><dt>Ocupação da agenda</dt><dd>${pct(t.minutos, s.capacity)}<small>até hoje, sobre ${Math.round(s.capacity / 60)} h de horário</small></dd></div>
          <div><dt>Taxa de faltas</dt><dd>${pct(t.faltas, fechados)}<small>${t.faltas} ${t.faltas === 1 ? 'falta' : 'faltas'} · ${t.cancelados} ${t.cancelados === 1 ? 'cancelado' : 'cancelados'}</small></dd></div>
          <div><dt>Espera até ao exame</dt><dd>${fmtDays(s.medians.wait)}<small>mediana, da reserva ao dia do exame</small></dd></div>
          <div><dt>Até ao relatório validado</dt><dd>${fmtDays(s.medians.report)}<small>mediana · ${t.relatorios}/${t.realizados} validados</small></dd></div>
          <div class="${t.porExecutar ? 'owed' : ''}"><dt>Executados no Siima</dt><dd>${t.executados}/${t.realizados}<small>${t.porExecutar ? html`<a href="/hoje#siima">${t.porExecutar} por executar</a>` : `em dia · mediana ${fmtDays(s.medians.siima)}`}</small></dd></div>
        </dl>
        <section class="sec"><div class="sec-h"><h2>Por tipo de exame</h2></div>
          ${s.byType.length ? html`<div class="scroll-x"><table class="table num-table"><thead><tr><th>Exame</th><th>Realizados</th><th>Faltas</th><th>Por realizar</th><th>Cancelados</th><th>Horas</th><th>Executados no Siima</th></tr></thead>
          <tbody>${s.byType.map((r) => html`<tr><td>${r.name}</td><td>${r.realizados}</td><td>${r.faltas}</td><td>${r.agendados}</td><td>${r.cancelados + r.recusados}</td><td>${(r.minutos / 60).toFixed(1).replace('.', ',')}</td><td>${r.executados}/${r.realizados}</td></tr>`)}</tbody>
          <tfoot><tr><td>Total</td><td>${t.realizados}</td><td>${t.faltas}</td><td>${t.agendados}</td><td>${t.cancelados + t.recusados}</td><td>${(t.minutos / 60).toFixed(1).replace('.', ',')}</td><td>${t.executados}/${t.realizados}</td></tr></tfoot></table></div>`
          : emptyState('Sem exames neste período.')}
        </section>
        <div class="two-col">
          <section class="sec"><div class="sec-h"><h2>Por origem</h2><span class="aside">exames realizados</span></div>${t.realizados ? html`<table class="table num-table">
            <thead><tr><th>Origem</th><th>Exames</th><th>%</th></tr></thead>
            <tbody>${s.byOrigin.map((o) => html`<tr><td>${ORIGIN_LABEL[o.origin]}</td><td>${o.n}</td><td>${pct(o.n, t.realizados)}</td></tr>`)}</tbody>
            <thead><tr><th>Circuito</th><th></th><th></th></tr></thead>
            <tbody>${Object.entries(s.bySource).map(([k, n]) => html`<tr><td>${SOURCE_LABEL[k]}</td><td>${n}</td><td>${pct(n, t.realizados)}</td></tr>`)}</tbody></table>` : emptyState('Sem exames realizados.')}</section>
          <section class="sec"><div class="sec-h"><h2>Projetos e ensaios servidos</h2></div>${s.projects.length ? html`<table class="table num-table"><thead><tr><th>Projeto / estudo</th><th>Exames</th></tr></thead><tbody>
            ${s.projects.map((p) => html`<tr><td>${p.project}</td><td>${p.n}</td></tr>`)}</tbody></table>` : emptyState('Nenhum neste período.')}</section>
        </div>
        ${months.length ? html`<section class="sec"><div class="sec-h"><h2>Mês a mês</h2></div><div class="scroll-x"><table class="table num-table"><thead><tr><th>Mês</th><th>Realizados</th><th class="hide-m"><span class="sr">Proporção</span></th><th>Faltas</th><th>Cancelados</th><th>Ocupação</th></tr></thead>
          <tbody>${months.map((m) => html`<tr><td><a href="/estatistica?ano=${year}&mes=${m.m}">${monthName(m.m)}</a></td><td>${m.realizados}</td>
            <td class="td-bar hide-m">${raw(`<svg class="bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="cap" width="100" height="8"/><rect width="${maxM ? Math.round((m.realizados / maxM) * 100) : 0}" height="8"/></svg>`)}</td>
            <td>${m.faltas}</td><td>${m.cancelados + m.recusados}</td><td>${pct(m.minutos, m.capacity)}</td></tr>`)}</tbody></table></div></section>` : ''}
        <p class="muted small">Ocupação = horas de exames realizados sobre as horas do horário de exames no período já decorrido. Medianas calculadas sobre os exames realizados do período.</p>`,
    });
  });

  app.get('/estatistica/exames.csv', async (req, reply) => {
    if (!isOrtho(req)) return forbid(reply);
    const year = Number.parseInt(str(req.query.ano), 10) || Number(todayLocal().slice(0, 4));
    const monthQ = Number.parseInt(str(req.query.mes), 10);
    const month = monthQ >= 1 && monthQ <= 12 ? monthQ : null;
    const { from, to } = range(year, month);
    const rows = db.prepare(`SELECT e.id, e.starts_at, t.name AS exame, r.source, r.origin, r.project, e.requisition, r.patient_process, e.status,
        e.minutes, e.siima_booked_at, e.siima_registered_at, rp.status AS relatorio
      FROM exams e JOIN exam_types t ON t.id = e.exam_type_id JOIN requests r ON r.id = e.request_id LEFT JOIN reports rp ON rp.exam_id = e.id
      WHERE e.starts_at >= ? AND e.starts_at < ? ORDER BY e.starts_at`).all(`${from}T00:00`, `${to}T00:00`);
    const header = ['id', 'data', 'hora', 'exame', 'circuito', 'origem', 'projeto', 'requisicao', 'processo', 'estado', 'minutos', 'marcado_siima', 'executado_siima', 'relatorio'];
    const lines = [header.join(';')];
    for (const r of rows) {
      lines.push([r.id, r.starts_at.slice(0, 10), r.starts_at.slice(11), r.exame, SOURCE_LABEL[r.source], ORIGIN_LABEL[r.origin], r.project, r.requisition, r.patient_process,
        STATUS_LABEL[r.status], r.minutes, r.source === 'direto' ? (r.siima_booked_at ? 'sim' : 'não') : '',
        r.siima_registered_at ? 'sim' : 'não', r.relatorio || ''].map(csvCell).join(';'));
    }
    const name = `exames-${year}${month ? `-${pad(month)}` : ''}.csv`;
    // BOM UTF-8 + ponto e vírgula: abre corretamente no Excel em português.
    return reply.type('text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${name}"`).send(`﻿${lines.join('\r\n')}\r\n`);
  });
}
