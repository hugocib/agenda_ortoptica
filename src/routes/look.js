// Aspeto: CSS dos temas, escolha do tema (para toda a app) e do modo claro/escuro (por dispositivo).
import { html, raw } from '../html.js';
import { audit, setSetting } from '../db.js';
import { MODES, THEME_IDS, THEMES } from '../themes.js';
import { flash, icon, MARK, pageHead, THEMES_CSS } from '../ui.js';
import { forbid, isOrtho, safeBack, send, str } from './util.js';

const MODE_LABEL = { auto: 'Automático', claro: 'Claro', escuro: 'Escuro' };

/** Amostra de um ecrã real («Hoje») com os componentes da app, no tema e modo indicados. */
function sample(t, mode) {
  const dots = (states) => raw(states.map((s) => `<i class="${s}"></i>`).join(''));
  return html`<div class="pv" data-theme="${t.id}" data-mode="${mode}" aria-hidden="true">
    <div class="pv-top">${MARK}<b class="pv-brand">Ortóptica</b><span class="pv-nav"><span class="on">Hoje</span><span>Agenda</span><span>Pedidos</span></span></div>
    <div class="pv-body">
      <p class="pv-h1">Terça, 27 de outubro</p>
      <div class="owed-line"><a><span class="n">2</span> por confirmar</a><a class="late"><span class="n">1</span> no Siima, atrasado</a></div>
      <div class="sec-h"><h2>Manhã</h2><span class="aside">3 h livres</span></div>
      <ol class="tape">
        <li class="t-exam s-realizado"><span class="t-time"><time>09:00</time><time class="end">10:30</time></span><div class="t-body"><div class="ex"><div><span class="ex-title">ERG campo total</span><div class="ex-meta"><span class="proc">R-2026/0412</span></div><div class="ex-state"><span class="track-wrap tone-pending"><span class="track">${dots(['done', 'done', 'done', 'next', 'todo'])}</span><span class="track-label">Falta o relatório</span></span></div></div></div></div></li>
        <li class="t-gap"><span class="t-time"><time>10:30</time></span><span class="t-body">Livre · 45 min <span class="gap-end">até 11:15</span></span></li>
        <li class="t-block"><span class="t-time"><time>11:15</time><time class="end">12:00</time></span><span class="t-body"><b>Bloqueado</b> · Reunião</span></li>
        <li class="t-exam"><span class="t-time"><time>12:00</time><time class="end">12:20</time></span><div class="t-body"><div class="ex"><div><span class="ex-title">OCT segmento posterior</span><div class="ex-meta"><span class="proc">R-2026/0419</span></div><div class="ex-state"><span class="track-wrap tone-pending"><span class="track">${dots(['next', 'todo', 'todo', 'todo', 'todo'])}</span><span class="track-label">Pendente: confirmar</span></span></div></div></div></div></li>
      </ol>
      <div class="pv-row"><span class="btn primary">Confirmar</span><span class="btn owed">Executado no Siima</span><span class="btn">Recusar</span></div>
      <div class="notice ok"><span>Guardado.</span><span class="btn link">Desfazer</span></div>
      <div class="pv-row pv-fields"><label>N.º de requisição<input value="R-2026/0431" tabindex="-1"></label>
        <span class="entry-eyes"><b class="od">OD</b> <span class="mono">0,8</span> <b class="oe">OE</b> <span class="mono">1,0</span> <span class="nflag">↓</span></span></div>
    </div>
  </div>`;
}

export default async function lookRoutes(app, { db }) {
  app.get('/temas.css', async (req, reply) =>
    reply.type('text/css; charset=utf-8').header('Cache-Control', 'public, max-age=31536000, immutable').send(THEMES_CSS));

  app.get('/aparencia', async (req, reply) => {
    const current = req.look.theme;
    const ortho = isOrtho(req);
    return send(reply, req, {
      title: 'Aspeto',
      active: 'conta',
      wide: true,
      body: html`${pageHead('Aspeto', {
        back: { href: '/conta', label: 'A minha conta' },
        info: ortho ? 'O tema aplica-se às suas páginas. A página de reservas do secretariado tem um tema fixo próprio (Administração → Reservas). O modo claro/escuro é escolhido em cada dispositivo.' : 'O tema é escolhido pelo ortoptista. O modo claro/escuro é escolhido em cada dispositivo.',
      })}
      ${flash(req.query, req)}
      <form method="post" action="/aparencia/modo" class="toolbar">
        <input type="hidden" name="back" value="/aparencia">
        <span class="seg" role="radiogroup" aria-label="Modo neste dispositivo">${MODES.map((m) => html`<label><input type="radio" name="modo" value="${m}"${req.look.mode === m ? raw(' checked') : ''}> ${MODE_LABEL[m]}</label>`)}</span>
        <button class="btn" type="submit">Aplicar neste dispositivo</button>
      </form>
      <ol class="themes">${THEMES.map((t, i) => html`<li class="theme${t.id === current ? ' current' : ''}" id="t-${t.id}">
        <div class="theme-h">
          <div><h2><span class="theme-n">${String(i + 1).padStart(2, '0')}</span> ${t.name}</h2><p class="muted small">${t.about}</p></div>
          ${t.id === current ? html`<span class="theme-on">${icon('certo', 'ico sm')} Em uso</span>`
            : ortho ? html`<form method="post" action="/aparencia" class="inline"><input type="hidden" name="theme" value="${t.id}"><button class="btn primary" type="submit">Usar este tema</button></form>` : ''}
        </div>
        <div class="theme-pvs">
          <figure><figcaption>Claro</figcaption>${sample(t, 'claro')}</figure>
          <figure><figcaption>Escuro</figcaption>${sample(t, 'escuro')}</figure>
        </div>
      </li>`)}</ol>`,
    });
  });

  app.post('/aparencia', async (req, reply) => {
    if (!isOrtho(req)) return forbid(reply);
    const id = str(req.body?.theme);
    if (!THEME_IDS.includes(id)) return reply.redirect('/aparencia?err=dados_invalidos');
    setSetting(db, 'theme', id);
    audit(db, req.user.id, 'tema', 'definicoes', null, { tema: id });
    return reply.redirect(`/aparencia?msg=tema#t-${id}`);
  });

  // Página de reservas: alterna claro/escuro neste browser (cookie só para /r/, não mexe na app).
  app.post('/aparencia/modo-reservas', async (req, reply) => {
    const mode = str(req.body?.modo) === 'escuro' ? 'escuro' : 'claro';
    const back = safeBack(req.body?.back, '/');
    const secure = req.protocol === 'https' ? '; Secure' : '';
    reply.header('set-cookie', `modo_r=${mode}; Path=/r/; Max-Age=${3600 * 24 * 400}; SameSite=Lax${secure}`);
    return reply.redirect(back.startsWith('/r/') ? back : '/');
  });

  // Público (também serve a página de reservas): só grava uma preferência de aspeto neste browser.
  app.post('/aparencia/modo', async (req, reply) => {
    const m = str(req.body?.modo);
    const mode = MODES.includes(m) ? m : 'auto';
    const secure = req.protocol === 'https' ? '; Secure' : '';
    reply.header('set-cookie', `modo=${mode}; Path=/; Max-Age=${3600 * 24 * 400}; SameSite=Lax${secure}`);
    return reply.redirect(safeBack(req.body?.back, '/conta'));
  });
}
