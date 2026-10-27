// «Fita» de um dia: exames, bloqueios e tempo livre por ordem, para a agenda e o ecrã «Hoje».
// O tempo livre só existe dentro do horário de exames (janelas de disponibilidade) e só
// aparece se couber pelo menos um passo da grelha. Funções puras: fáceis de testar.
import { addDays, toMin, fromMin } from '../time.js';

const hhmm = (ldt, date) => {
  if (ldt <= `${date}T00:00`) return '00:00';
  if (ldt >= `${addDays(date, 1)}T00:00`) return '24:00';
  return ldt.slice(11, 16);
};

/** Subtrai intervalos ocupados [a,b) de uma janela [s,e) (minutos). */
export function freeIntervals(start, end, busy) {
  const sorted = busy.filter(([a, b]) => b > start && a < end).sort((x, y) => x[0] - y[0]);
  const out = [];
  let cur = start;
  for (const [a, b] of sorted) {
    if (a > cur) out.push([cur, Math.min(a, end)]);
    cur = Math.max(cur, b);
    if (cur >= end) break;
  }
  if (cur < end) out.push([cur, end]);
  return out;
}

/**
 * @param {object} p
 * @param {string} p.date        'YYYY-MM-DD'
 * @param {Array}  p.windows     janelas de disponibilidade desse dia [{start,end}]
 * @param {Array}  p.exams       exames desse dia (com starts_at/ends_at)
 * @param {Array}  p.blocks      bloqueios que tocam esse dia
 * @param {number} p.step        grelha em minutos (gap mínimo)
 * @param {string} [p.nowTime]   'HH:MM' se for hoje (marca o livre que já passou)
 */
export function dayTape({ date, windows = [], exams = [], blocks = [], holds = [], step = 15, nowTime = null }) {
  const blockItems = blocks.map((b) => ({ kind: 'block', start: hhmm(b.starts_at, date), end: hhmm(b.ends_at, date), block: b }));
  const examItems = exams.map((e) => ({ kind: 'exam', start: e.starts_at.slice(11, 16), end: e.ends_at.slice(11, 16), exam: e }));
  // Hora proposta num pedido de alteração: ainda não é o exame, mas já está reservada.
  const holdItems = holds.map((e) => ({ kind: 'hold', start: e.change_starts_at.slice(11, 16), end: e.change_ends_at.slice(11, 16), exam: e }));
  const busy = [
    ...examItems.filter((i) => i.exam.status !== 'faltou').map((i) => [toMin(i.start), toMin(i.end)]),
    ...holdItems.map((i) => [toMin(i.start), toMin(i.end)]),
    ...blockItems.map((i) => [toMin(i.start), i.end === '24:00' ? 1440 : toMin(i.end)]),
  ];
  const gaps = [];
  for (const w of windows) {
    for (const [a, b] of freeIntervals(toMin(w.start), toMin(w.end), busy)) {
      if (b - a < step) continue;
      gaps.push({ kind: 'gap', start: fromMin(a), end: fromMin(b), minutes: b - a, past: nowTime !== null && fromMin(b) <= nowTime });
    }
  }
  const order = { block: 0, exam: 1, hold: 2, gap: 3 };
  const items = [...blockItems, ...examItems, ...holdItems, ...gaps].sort((x, y) => x.start.localeCompare(y.start) || order[x.kind] - order[y.kind]);
  const freeMinutes = gaps.filter((g) => !g.past).reduce((s, g) => s + g.minutes, 0);
  return { items, freeMinutes };
}

/**
 * Divide a fita em períodos (manhã, tarde) segundo as janelas do horário. O intervalo entre
 * janelas (almoço) fica assinalado; o que estiver fora do horário vai para o período mais próximo.
 */
export function periods(t, windows) {
  const ws = [...windows].sort((a, b) => a.start.localeCompare(b.start));
  if (ws.length < 2) return [{ label: ws.length ? periodName(ws[0].start) : '', window: ws[0] || null, items: t.items, pause: null }];
  const out = ws.map((w, i) => ({
    label: periodName(w.start), window: w, items: [],
    pause: i > 0 && ws[i - 1].end < w.start ? { start: ws[i - 1].end, end: w.start } : null,
  }));
  for (const it of t.items) {
    let k = out.findIndex((p) => it.start < p.window.end);
    if (k < 0) k = out.length - 1;
    out[k].items.push(it);
  }
  // Nomes repetidos (duas janelas de manhã) ficam numerados.
  const seen = {};
  for (const p of out) { seen[p.label] = (seen[p.label] || 0) + 1; if (seen[p.label] > 1) p.label = `${p.label} (${seen[p.label]})`; }
  return out;
}

export function periodName(start) {
  return start < '13:00' ? 'Manhã' : start < '19:00' ? 'Tarde' : 'Noite';
}

/** «1 h 15», «45 min» */
export function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}
