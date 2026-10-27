// Templates HTML com escape automático. Tudo o que entra numa página passa por esc(),
// exceto o que for explicitamente marcado como seguro com html`` ou raw().
// Isto evita XSS com dados de formulário (nomes, notas, valores de relatório).

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export const raw = (s) => new Safe(String(s));

export function esc(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(esc).join('');
  return String(v).replace(/[&<>"']/g, (c) => ESC[c]);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += esc(values[i]) + strings[i + 1];
  return new Safe(out);
}

export const euros = (cents) =>
  (cents / 100).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR', minimumFractionDigits: cents % 100 ? 2 : 0 });
