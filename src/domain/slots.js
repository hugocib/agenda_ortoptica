// Lógica de vagas, sem acesso à base de dados (funções puras, testáveis).
// Intervalos em hora local 'YYYY-MM-DDTHH:MM'; o formato fixo permite comparar como texto.
import { addDays, addMinutes, fromMin, toMin, weekday } from '../time.js';

export const REASONS = {
  passado: 'Esse horário já passou.',
  fora_horario: 'Fora do horário de exames externos.',
  sobreposicao: 'Sobrepõe-se a outro exame marcado.',
  bloqueado: 'Esse período está bloqueado.',
  limite_electro: 'Já há o máximo de exames de eletrofisiologia nesse dia.',
  desalinhado: 'A hora de início tem de coincidir com a grelha da agenda.',
};

export function roundUp(minutes, step) {
  return Math.ceil(minutes / step) * step;
}

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

/**
 * Verifica se um exame pode começar em `start`.
 * ctx: { availability, step, busy:[{starts_at, ends_at, is_electro, id}], blocks:[{starts_at, ends_at}],
 *        maxElectro, now, ignoreExamId }
 */
export function checkSlot(start, minutes, isElectro, ctx) {
  const step = ctx.step;
  const duration = roundUp(minutes, step);
  const end = addMinutes(start, duration);
  if (ctx.now && start < ctx.now) return { ok: false, reason: 'passado' };

  const date = start.slice(0, 10);
  const startMin = toMin(start.slice(11));
  const endMin = startMin + duration;
  const windows = ctx.availability.filter((w) => w.weekday === weekday(date));
  const win = windows.find((w) => toMin(w.start) <= startMin && endMin <= toMin(w.end));
  if (!win) return { ok: false, reason: 'fora_horario' };
  if ((startMin - toMin(win.start)) % step !== 0) return { ok: false, reason: 'desalinhado' };

  for (const b of ctx.blocks) {
    if (overlaps(start, end, b.starts_at, b.ends_at)) return { ok: false, reason: 'bloqueado' };
  }
  let electroThatDay = 0;
  for (const e of ctx.busy) {
    if (ctx.ignoreExamId && e.id === ctx.ignoreExamId) continue;
    if (overlaps(start, end, e.starts_at, e.ends_at)) return { ok: false, reason: 'sobreposicao' };
    if (e.is_electro && e.starts_at.slice(0, 10) === date) electroThatDay++;
  }
  if (isElectro && electroThatDay >= ctx.maxElectro) return { ok: false, reason: 'limite_electro' };
  return { ok: true, end };
}

/** Lista as horas livres por dia, a partir de fromDate, durante `days` dias. */
export function freeSlots({ fromDate, days, minutes, isElectro, ...ctx }) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(fromDate, i);
    const windows = ctx.availability.filter((w) => w.weekday === weekday(date));
    if (!windows.length) continue;
    const times = [];
    for (const w of windows) {
      for (let t = toMin(w.start); t + roundUp(minutes, ctx.step) <= toMin(w.end); t += ctx.step) {
        const start = `${date}T${fromMin(t)}`;
        if (checkSlot(start, minutes, isElectro, ctx).ok) times.push(fromMin(t));
      }
    }
    out.push({ date, times });
  }
  return out;
}

/** Minutos de agenda disponíveis num intervalo de datas [from, to). */
export function capacityMinutes(availability, from, to) {
  let total = 0;
  for (let d = from; d < to; d = addDays(d, 1)) {
    for (const w of availability) if (w.weekday === weekday(d)) total += toMin(w.end) - toMin(w.start);
  }
  return total;
}
