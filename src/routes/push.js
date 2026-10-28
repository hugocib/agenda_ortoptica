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
    const r = await notify(db, { title: 'Ortóptica — teste do servidor', body: 'Notificações ativas: vai receber aqui as reservas do secretariado.', url: '/conta' }, { userId: req.user.id, log: req.log, details: true });
    return { ok: r.sent > 0, sent: r.sent, status: r.statuses.join(', ') || 'sem dispositivos registados' };
  });
}
