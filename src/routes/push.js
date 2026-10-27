// Ativar / desativar notificações push neste dispositivo e enviar um teste.
import { notify, removeSubscription, saveSubscription, vapidKeys } from '../push.js';

export default async function pushRoutes(app, { db }) {
  app.get('/push/chave', async () => ({ key: vapidKeys(db).publicKey }));

  app.post('/push/subscrever', async (req, reply) => {
    const origin = `${req.protocol}://${req.headers.host}`;
    if (!saveSubscription(db, req.user.id, req.body, origin)) return reply.code(400).send({ ok: false });
    return { ok: true };
  });

  app.post('/push/cancelar', async (req) => ({ ok: true, removed: removeSubscription(db, req.user.id, req.body?.endpoint) }));

  app.post('/push/teste', async (req) => {
    const n = await notify(db, { title: 'Ortóptica', body: 'Notificações ativas neste dispositivo.', url: '/conta', tag: 'teste' }, { userId: req.user.id, log: req.log });
    return { ok: n > 0, sent: n };
  });
}
