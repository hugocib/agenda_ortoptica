// Datas e horas. As marcações são guardadas como hora local de Lisboa ('YYYY-MM-DDTHH:MM'),
// porque é assim que a agenda é pensada; só o ICS precisa de converter para UTC.
// Não depende do fuso do contentor: usa sempre Intl com timeZone explícito.
const TZ = 'Europe/Lisbon';

const pad = (n) => String(n).padStart(2, '0');

function partsIn(date, timeZone = TZ) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second };
}

export function nowLocal(now = new Date()) {
  const p = partsIn(now);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}`;
}

export function todayLocal(now = new Date()) {
  return nowLocal(now).slice(0, 10);
}

export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export function isLocalDateTime(s) {
  return typeof s === 'string' && s.length === 16 && s[10] === 'T' && isDate(s.slice(0, 10)) && isTime(s.slice(11));
}

export function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function fromMin(min) {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// 0 = domingo ... 6 = sábado
export function weekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function mondayOf(date) {
  const wd = weekday(date);
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

export function addMinutes(localDateTime, minutes) {
  const date = localDateTime.slice(0, 10);
  const total = toMin(localDateTime.slice(11)) + minutes;
  const dayShift = Math.floor(total / 1440);
  return `${addDays(date, dayShift)}T${fromMin(((total % 1440) + 1440) % 1440)}`;
}

export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// Converte hora local de Lisboa em Date (UTC), tratando a mudança de hora.
export function localToUtc(localDateTime) {
  const [date, time] = localDateTime.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, h, min);
  const offsetAt = (ms) => {
    const p = partsIn(new Date(ms));
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - ms;
  };
  let guess = asUtc - offsetAt(asUtc);
  guess = asUtc - offsetAt(guess);
  return new Date(guess);
}

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function fmtDate(date) {
  if (!date) return '';
  const [y, m, d] = date.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function fmtDateLong(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${WEEKDAYS[weekday(date)]}, ${d} de ${MONTHS[m - 1]}`;
}

export function fmtDateTime(ldt) {
  if (!ldt) return '';
  return `${fmtDate(ldt.slice(0, 10))} ${ldt.slice(11, 16)}`;
}

export function monthName(m) {
  return MONTHS[m - 1];
}

export function fmtUtcLocal(isoUtc) {
  if (!isoUtc) return '';
  return fmtDateTime(nowLocal(new Date(isoUtc)));
}

export function ageAt(birthDate, onDate) {
  if (!birthDate || !onDate) return null;
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [y, m, d] = onDate.slice(0, 10).split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}
