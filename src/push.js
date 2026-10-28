// Notificações push (Web Push com chaves VAPID). As chaves são criadas na primeira utilização e
// ficam nas definições. O conteúdo das notificações nunca tem dados de doentes: só o tipo de
// exame, a hora e quem reservou.
import webpush from 'web-push';
import { getSetting, setSetting } from './db.js';

export function vapidKeys(db) {
  let keys = getSetting(db, 'vapid');
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    setSetting(db, 'vapid', keys);
  }
  return keys;
}

export function saveSubscription(db, userId, sub, origin) {
  const endpoint = String(sub?.endpoint || '');
  const p256dh = String(sub?.keys?.p256dh || '');
  const auth = String(sub?.keys?.auth || '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) return false;
  db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`).run(userId, endpoint, p256dh, auth);
  // O «subject» VAPID tem de ser um URL de contacto válido; usa-se o endereço da própria app.
  if (/^https:\/\/[^/]+$/.test(origin) && !/localhost|127\.0\.0\.1/.test(origin)) setSetting(db, 'push_subject', origin);
  return true;
}

export function removeSubscription(db, userId, endpoint) {
  return db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, String(endpoint || '')).changes;
}

/**
 * Envia a todos os dispositivos dos ortoptistas (ou só aos de `userId`). Não bloqueia quem chama:
 * as falhas ficam no registo e as subscrições que já não existem são apagadas.
 */
export function notify(db, { title, body, url = '/hoje', tag }, { userId = null, log = null, send = webpush.sendNotification, details = false } = {}) {
  const subs = userId
    ? db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId)
    : db.prepare(`SELECT s.* FROM push_subscriptions s JOIN users u ON u.id = s.user_id WHERE u.active = 1 AND u.role = 'ortoptista'`).all();
  if (!subs.length) return Promise.resolve(details ? { sent: 0, statuses: [] } : 0);
  const keys = vapidKeys(db);
  const subject = getSetting(db, 'push_subject') || 'mailto:ortoptica@example.invalid';
  const payload = JSON.stringify({ title, body, url, tag });
  return Promise.all(subs.map((s) => send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
    TTL: 12 * 3600,
    urgency: 'normal',
    vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
  }).then((res) => { log?.info({ status: res?.statusCode }, 'notificação push aceite'); return { ok: 1, status: res?.statusCode }; }).catch((err) => {
    if (err?.statusCode === 404 || err?.statusCode === 410) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
    else log?.warn({ status: err?.statusCode, msg: err?.message, body: String(err?.body || '').slice(0, 200) }, 'notificação push falhou');
    return { ok: 0, status: err?.statusCode || 0 };
  }))).then((r) => {
    const sent = r.reduce((a, b) => a + b.ok, 0);
    return details ? { sent, statuses: r.map((x) => x.status) } : sent;
  });
}
