// Autenticação: palavras-passe com scrypt, sessões em base de dados (o token só existe no
// cookie; na BD guarda-se o hash), cookie HttpOnly + SameSite=Strict, verificação de Origin
// em todos os POST e limite de tentativas de login.
import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(expected, actual);
}

// Hash fixo para comparar quando o utilizador não existe (tempo de resposta igual).
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

export function generatePassword() {
  // 12 caracteres sem ambiguidades (sem 0/O, 1/l/I)
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function validatePasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'A palavra-passe tem de ter pelo menos 10 caracteres.';
  if (pw.length > 200) return 'Palavra-passe demasiado longa.';
  return null;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const COOKIE = 'sid';

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id) VALUES (?, ?)').run(sha256(token), userId);
  return token;
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function destroyUserSessions(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function loadSession(db, token, idleHours) {
  if (!token) return null;
  const h = sha256(token);
  const row = db.prepare(`SELECT s.token_hash, s.last_seen_at, u.id, u.username, u.display_name, u.role, u.must_change_password, u.active
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(h);
  if (!row) return null;
  const idleMs = Date.now() - Date.parse(row.last_seen_at);
  if (!row.active || idleMs > idleHours * 3600 * 1000) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h);
    return null;
  }
  // Atualiza no máximo uma vez por minuto, para não escrever na BD em cada pedido.
  if (idleMs > 60 * 1000) {
    db.prepare("UPDATE sessions SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE token_hash = ?").run(h);
  }
  return { id: row.id, username: row.username, name: row.display_name, role: row.role, mustChangePassword: !!row.must_change_password };
}

export function purgeExpiredSessions(db, idleHours) {
  const cutoff = new Date(Date.now() - idleHours * 3600 * 1000).toISOString();
  db.prepare('DELETE FROM sessions WHERE last_seen_at < ?').run(cutoff);
}

export function sessionCookie(token, { secure, maxAgeSeconds }) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSeconds}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function checkLogin(db, username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!user || !user.active) {
    verifyPassword(String(password || ''), DUMMY_HASH);
    return null;
  }
  return verifyPassword(String(password || ''), user.password_hash) ? user : null;
}

// Limite de tentativas: 5 falhas em 15 min por IP+utilizador bloqueiam durante 15 min.
export class LoginLimiter {
  constructor({ max = 5, windowMs = 15 * 60 * 1000 } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.map = new Map();
  }
  key(ip, username) { return `${ip}|${String(username || '').toLowerCase()}`; }
  blocked(ip, username) {
    const e = this.map.get(this.key(ip, username));
    if (!e) return false;
    if (Date.now() - e.first > this.windowMs) { this.map.delete(this.key(ip, username)); return false; }
    return e.count >= this.max;
  }
  fail(ip, username) {
    const k = this.key(ip, username);
    const e = this.map.get(k);
    if (!e || Date.now() - e.first > this.windowMs) this.map.set(k, { count: 1, first: Date.now() });
    else e.count++;
  }
  reset(ip, username) { this.map.delete(this.key(ip, username)); }
}

// Proteção CSRF: SameSite=Strict + Origin igual ao Host em todos os pedidos que alteram dados.
export function sameOrigin(request) {
  const host = request.headers['x-forwarded-host'] && request.server.initialConfig.trustProxy
    ? request.headers['x-forwarded-host']
    : request.headers.host;
  const src = request.headers.origin || request.headers.referer;
  if (!src || !host) return false;
  // Portas por omissão podem vir ou não no cabeçalho Host: normalizar antes de comparar.
  const norm = (h) => String(h).toLowerCase().replace(/:(80|443)$/, '');
  try {
    return norm(new URL(src).host) === norm(host);
  } catch {
    return false;
  }
}
