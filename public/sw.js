// Service worker deliberadamente conservador:
// - guarda em cache só ficheiros estáticos (CSS, JS, ícones, tipos de letra do tema em uso);
// - páginas com dados de doentes NUNCA ficam em cache (privacidade e dados sempre atuais);
// - sem ligação, mostra uma página a explicar, em vez de dados desatualizados.
const VERSION = '__VERSION__';
const CACHE = `ortoptica-static-${VERSION}`;
const PRECACHE = [
  `/static/app.css?v=${VERSION}`,
  `/static/app.js?v=${VERSION}`,
  `/static/icons.svg?v=${VERSION}`,
  `/temas.css?v=${VERSION}`,
  '/static/icon.svg',
  '/static/icon-192.png',
  '/offline',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ortoptica-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/static/') || url.pathname === '/temas.css') {
    // Ficheiros versionados: o que vem da rede fica guardado (ex.: tipos de letra do tema escolhido).
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline')));
  }
  // Tudo o resto vai diretamente à rede.
});

// Notificações push: só texto sem dados de doentes (tipo de exame, hora, quem reservou).
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Ortóptica', body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Ortóptica', {
    body: data.body || '',
    tag: data.tag,
    renotify: Boolean(data.tag),
    icon: '/static/icon-192.png',
    badge: '/static/icon-192.png',
    data: { url: data.url || '/hoje' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/hoje', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) {
      if (w.url.startsWith(self.location.origin) && 'focus' in w) { w.navigate(url); return w.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
