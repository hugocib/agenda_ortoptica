import { html, euros, raw } from '../html.js';
import { emptyState, pageHead } from '../ui.js';
import { getSetting } from '../db.js';
import { capacityMinutes } from '../domain/slots.js';
import { ORIGIN_LABEL, STATUS_LABEL } from '../domain/status.js';
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

function pct(a, b) {
  return b ? `${Math.round((a / b) * 100)}%` : '—';
}

export function computeStats(db, year, month) {
  const { from, to } = range(year, month);
  const rows = db.prepare(`SELECT e.*, t.name AS type_name, t.sort, r.origin
    FROM exams e JOIN exam_types t ON t.id = e.exam_type_id JOIN requests r ON r.id = e.request_id
    WHERE e.starts_at >= ? AND e.starts_at < ?`).all(`${from}T00:00`, `${to}T00:00`);
  const byType = new Map();
  const totals = { realizados: 0, faltas: 0, agendados: 0, registados: 0, porRegistar: 0, relatorios: 0, receita: 0, interno: 0, minutos: 0 };
  const reports = new Set(db.prepare("SELECT exam_id FROM reports WHERE status = 'validado'").pluck().all());
  for (const e of rows) {
    if (!byType.has(e.type_name)) byType.set(e.type_name, { name: e.type_name, sort: e.sort, realizados: 0, faltas: 0, agendados: 0, registados: 0, receita: 0, interno: 0 });
    const t = byType.get(e.type_name);
    if (e.status === 'realizado') {
      t.realizados++; totals.realizados++;
      totals.minutos += e.minutes;
      if (e.siima_registered_at) { t.registados++; totals.registados++; } else totals.porRegistar++;
      if (reports.has(e.id)) totals.relatorios++;
      if (e.origin === 'projeto') { t.interno += e.price_cents; totals.interno += e.price_cents; } else { t.receita += e.price_cents; totals.receita += e.price_cents; }
    } else if (e.status === 'faltou') { t.faltas++; totals.faltas++; } else if (e.status === 'agendado') { t.agendados++; totals.agendados++; }
  }
  const byOrigin = db.prepare(`SELECT r.origin, COUNT(*) AS n FROM exams e JOIN requests r ON r.id = e.request_id
    WHERE e.status = 'realizado' AND e.starts_at >= ? AND e.starts_at < ? GROUP BY r.origin`).all(`${from}T00:00`, `${to}T00:00`);
  const projects = db.prepare(`SELECT r.project, COUNT(*) AS n, SUM(e.price_cents) AS valor FROM exams e JOIN requests r ON r.id = e.request_id
    WHERE e.status = 'realizado' AND r.origin = 'projeto' AND e.starts_at >= ? AND e.starts_at < ? GROUP BY r.project ORDER BY n DESC`).all(`${from}T00:00`, `${to}T00:00`);
  // Ocupação só sobre o período já decorrido e desde que a app começou a ser usada;
  // senão um ano inteiro com 2 meses de uso daria uma percentagem enganadora.
  const firstUse = db.prepare('SELECT MIN(substr(starts_at, 1, 10)) FROM exams WHERE starts_at IS NOT NULL').pluck().get();
  const capFrom = firstUse && firstUse > from ? firstUse : from;
  const tomorrow = addDays(todayLocal(), 1);
  const capTo = tomorrow < to ? tomorrow : to;
  const capacity = capFrom < capTo ? capacityMinutes(getSetting(db, 'availability'), capFrom, capTo) : 0;
  return { from, to, rows, byType: [...byType.values()].sort((a, b) => a.sort - b.sort), totals, byOrigin, projects, capacity };
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
          <div><dt>Exames realizados</dt><dd>${t.realizados}</dd></div>
          <div><dt>Receita externa estimada</dt><dd>${euros(t.receita)}<small>preço de tabela no pedido</small></dd></div>
          <div><dt>Serviço a projetos</dt><dd>${euros(t.interno)}<small>a preço de tabela</small></dd></div>
          <div><dt>Ocupação da agenda</dt><dd>${pct(t.minutos, s.capacity)}<small>até hoje: ${Math.round(t.minutos / 60)} h de ${Math.round(s.capacity / 60)} h</small></dd></div>
          <div><dt>Taxa de faltas</dt><dd>${pct(t.faltas, t.faltas + t.realizados)}<small>${t.faltas} ${t.faltas === 1 ? 'falta' : 'faltas'}</small></dd></div>
          <div class="${t.porRegistar ? 'owed' : ''}"><dt>Por registar no Siima</dt><dd>${t.porRegistar}<small>${t.porRegistar ? html`<a href="/hoje#siima">ver lista</a>` : 'em dia'}</small></dd></div>
        </dl>
        <section class="sec"><div class="sec-h"><h2>Por tipo de exame</h2></div>
          ${s.byType.length ? html`<div class="scroll-x"><table class="table num-table"><thead><tr><th>Exame</th><th>Realizados</th><th>Faltas</th><th>Agendados</th><th>Registados no Siima</th><th>Receita</th><th>Valor interno</th></tr></thead>
          <tbody>${s.byType.map((r) => html`<tr><td>${r.name}</td><td>${r.realizados}</td><td>${r.faltas}</td><td>${r.agendados}</td><td>${r.registados}/${r.realizados}</td><td>${euros(r.receita)}</td><td>${euros(r.interno)}</td></tr>`)}</tbody>
          <tfoot><tr><td>Total</td><td>${t.realizados}</td><td>${t.faltas}</td><td>${t.agendados}</td><td>${t.registados}/${t.realizados}</td><td>${euros(t.receita)}</td><td>${euros(t.interno)}</td></tr></tfoot></table></div>`
          : emptyState('Sem exames neste período.')}
        </section>
        <div class="two-col">
          <section class="sec"><div class="sec-h"><h2>Por origem</h2></div>${s.byOrigin.length ? html`<table class="table num-table"><tbody>
            ${s.byOrigin.map((o) => html`<tr><td>${ORIGIN_LABEL[o.origin]}</td><td>${o.n}</td></tr>`)}</tbody></table>` : emptyState('Sem exames realizados.')}</section>
          <section class="sec"><div class="sec-h"><h2>Projetos servidos</h2></div>${s.projects.length ? html`<table class="table num-table"><thead><tr><th>Projeto</th><th>Exames</th><th>Valor</th></tr></thead><tbody>
            ${s.projects.map((p) => html`<tr><td>${p.project || '—'}</td><td>${p.n}</td><td>${euros(p.valor || 0)}</td></tr>`)}</tbody></table>` : emptyState('Nenhum neste período.')}</section>
        </div>
        ${months.length ? html`<section class="sec"><div class="sec-h"><h2>Mês a mês</h2></div><div class="scroll-x"><table class="table num-table"><thead><tr><th>Mês</th><th>Realizados</th><th class="hide-m"><span class="sr">Proporção</span></th><th>Faltas</th><th>Receita</th><th>Valor interno</th><th>Ocupação</th></tr></thead>
          <tbody>${months.map((m) => html`<tr><td><a href="/estatistica?ano=${year}&mes=${m.m}">${monthName(m.m)}</a></td><td>${m.realizados}</td>
            <td class="td-bar hide-m">${raw(`<svg class="bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="cap" width="100" height="8"/><rect width="${maxM ? Math.round((m.realizados / maxM) * 100) : 0}" height="8"/></svg>`)}</td>
            <td>${m.faltas}</td><td>${euros(m.receita)}</td><td>${euros(m.interno)}</td><td>${pct(m.minutos, m.capacity)}</td></tr>`)}</tbody></table></div></section>` : ''}
        <p class="muted small">Receita = soma dos preços de tabela registados no pedido para exames realizados de origem externa ou ensaio; não substitui a faturação da UC.</p>`,
    });
  });

  app.get('/estatistica/exames.csv', async (req, reply) => {
    if (!isOrtho(req)) return forbid(reply);
    const year = Number.parseInt(str(req.query.ano), 10) || Number(todayLocal().slice(0, 4));
    const monthQ = Number.parseInt(str(req.query.mes), 10);
    const month = monthQ >= 1 && monthQ <= 12 ? monthQ : null;
    const { from, to } = range(year, month);
    const rows = db.prepare(`SELECT e.id, e.starts_at, t.name AS exame, t.sap_code, r.origin, r.project, r.patient_process, e.status,
        e.price_cents, e.minutes, e.siima_booked_at, e.siima_registered_at, rp.status AS relatorio
      FROM exams e JOIN exam_types t ON t.id = e.exam_type_id JOIN requests r ON r.id = e.request_id LEFT JOIN reports rp ON rp.exam_id = e.id
      WHERE e.starts_at >= ? AND e.starts_at < ? ORDER BY e.starts_at`).all(`${from}T00:00`, `${to}T00:00`);
    const header = ['id', 'data', 'hora', 'exame', 'codigo_sap', 'origem', 'projeto', 'processo', 'estado', 'preco_eur', 'minutos', 'marcado_siima', 'registado_siima', 'relatorio'];
    const lines = [header.join(';')];
    for (const r of rows) {
      lines.push([r.id, r.starts_at.slice(0, 10), r.starts_at.slice(11), r.exame, r.sap_code, ORIGIN_LABEL[r.origin], r.project, r.patient_process,
        STATUS_LABEL[r.status], (r.price_cents / 100).toFixed(2).replace('.', ','), r.minutes, r.siima_booked_at ? 'sim' : 'não',
        r.siima_registered_at ? 'sim' : 'não', r.relatorio || ''].map(csvCell).join(';'));
    }
    const name = `exames-${year}${month ? `-${pad(month)}` : ''}.csv`;
    // BOM UTF-8 + ponto e vírgula: abre corretamente no Excel em português.
    return reply.type('text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${name}"`).send(`﻿${lines.join('\r\n')}\r\n`);
  });
}

