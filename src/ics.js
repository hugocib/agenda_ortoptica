// Calendário ICS só de leitura, para subscrever no Outlook/telemóvel.
// Sem dados de doentes: só o tipo de exame e a hora.
import { localToUtc } from './time.js';

const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const escText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function fold(line) {
  const out = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 74) {
    let cut = 74;
    while (Buffer.byteLength(rest.slice(0, cut)) > 74) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

export function buildIcs({ exams, blocks, host }) {
  const now = fmt(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CIBIT-ICNAS//Ortoptica Agenda//PT', 'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Ortóptica — exames', 'X-PUBLISHED-TTL:PT15M'];
  for (const e of exams) {
    lines.push('BEGIN:VEVENT', `UID:exame-${e.id}@${host}`, `DTSTAMP:${now}`,
      `DTSTART:${fmt(localToUtc(e.starts_at))}`, `DTEND:${fmt(localToUtc(e.ends_at))}`,
      `SUMMARY:${escText(`${e.status === 'pendente' ? '[por confirmar] ' : ''}${e.type_name}${e.origin === 'projeto' ? ' (projeto)' : e.origin === 'ensaio' ? ' (ensaio)' : ''}`)}`,
      `DESCRIPTION:${escText(`Exame n.º ${e.id} · ${e.status}`)}`,
      e.status === 'pendente' ? 'STATUS:TENTATIVE' : 'STATUS:CONFIRMED', 'END:VEVENT');
  }
  for (const b of blocks) {
    lines.push('BEGIN:VEVENT', `UID:bloqueio-${b.id}@${host}`, `DTSTAMP:${now}`,
      `DTSTART:${fmt(localToUtc(b.starts_at))}`, `DTEND:${fmt(localToUtc(b.ends_at))}`,
      `SUMMARY:${escText(`Bloqueado: ${b.reason}`)}`, 'TRANSP:OPAQUE', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
