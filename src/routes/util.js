import { layout } from '../ui.js';

export function str(v) {
  if (Array.isArray(v)) v = v[0];
  return typeof v === 'string' ? v : '';
}

export function arr(v) {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string');
}

// Só aceita caminhos locais (evita redirecionamentos para outros sites).
export function safeBack(back, fallback) {
  const b = str(back);
  return b.startsWith('/') && !b.startsWith('//') && !b.includes('\\') ? b : fallback;
}

export function withParam(url, key, value) {
  const [beforeHash, hash = ''] = url.split('#');
  const [p, q = ''] = beforeHash.split('?');
  const params = new URLSearchParams(q);
  params.delete('msg');
  params.delete('err');
  params.delete('u');
  params.set(key, value);
  return `${p}?${params}${hash ? `#${hash}` : ''}`;
}

// Mensagem de sucesso; para ações que se podem desfazer, leva o id do exame (não é dado pessoal).
const UNDOABLE = new Set(['siima_marcado', 'siima_registado', 'realizado']);
export function withMsg(url, msg, id) {
  const [beforeHash, hash = ''] = url.split('#');
  const [p, q = ''] = beforeHash.split('?');
  const params = new URLSearchParams(q);
  for (const k of ['msg', 'err', 'u']) params.delete(k);
  params.set('msg', msg);
  if (UNDOABLE.has(msg) && id) params.set('u', String(id));
  return `${p}?${params}${hash ? `#${hash}` : ''}`;
}

export function send(reply, req, opts, status = 200) {
  return reply.code(status).type('text/html; charset=utf-8').send(layout(req, opts));
}

export function isOrtho(req) {
  return req.user?.role === 'ortoptista';
}

export function forbid(reply) {
  return reply.code(403).type('text/plain; charset=utf-8').send('Sem permissão.');
}

export function idParam(req) {
  const n = Number.parseInt(req.params.id, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
