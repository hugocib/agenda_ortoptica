import { html, raw } from '../html.js';
import { themeById } from '../themes.js';
import { audit } from '../db.js';
import {
  checkLogin, COOKIE, createSession, destroySession, destroyUserSessions, hashPassword,
  readCookie, sessionCookie, validatePasswordStrength, verifyPassword,
} from '../auth.js';
import { flash, MARK, pageHead } from '../ui.js';
import { safeBack, send, str } from './util.js';

function loginPage(req, { error = '', username = '', next = '' } = {}) {
  return {
    title: 'Entrar',
    bare: true,
    body: html`<div class="gate">
      ${MARK}
      <h1>Ortóptica</h1>
      <p class="lede">Agenda, registo no Siima e relatórios de exames.</p>
      ${error ? html`<div class="notice err" role="alert">${error}</div>` : ''}
      <form method="post" action="/login">
        <input type="hidden" name="next" value="${next}">
        <label>Utilizador<input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required${username ? '' : html` autofocus`} value="${username}"></label>
        <label>Palavra-passe<input name="password" type="password" autocomplete="current-password" required${username ? html` autofocus` : ''}></label>
        <button class="btn primary big" type="submit">Entrar</button>
      </form>
      <p class="gate-foot">O secretariado não precisa de entrar: usa o link de reservas.</p>
    </div>`,
  };
}

export default async function authRoutes(app, { db, config, limiter }) {
  app.get('/login', async (req, reply) => {
    if (req.user) return reply.redirect('/hoje');
    return send(reply, req, loginPage(req, { next: safeBack(req.query.next, '') }));
  });

  app.post('/login', async (req, reply) => {
    const username = str(req.body?.username).trim();
    const password = str(req.body?.password);
    const next = safeBack(req.body?.next, '/hoje');
    if (limiter.blocked(req.ip, username)) {
      return send(reply, req, loginPage(req, { error: 'Demasiadas tentativas. Espere 15 minutos.', username, next }), 429);
    }
    const user = checkLogin(db, username, password);
    if (!user) {
      limiter.fail(req.ip, username);
      return send(reply, req, loginPage(req, { error: 'Utilizador ou palavra-passe errados.', username, next }), 401);
    }
    limiter.reset(req.ip, username);
    const token = createSession(db, user.id);
    audit(db, user.id, 'login', 'utilizador', user.id);
    reply.header('set-cookie', sessionCookie(token, { secure: req.protocol === 'https', maxAgeSeconds: config.sessionIdleHours * 3600 * 3 }));
    return reply.redirect(user.must_change_password ? '/conta' : next);
  });

  app.post('/logout', async (req, reply) => {
    destroySession(db, readCookie(req.headers.cookie, COOKIE));
    reply.header('set-cookie', sessionCookie('', { secure: req.protocol === 'https', maxAgeSeconds: 0 }));
    return reply.redirect('/login');
  });

  const contaPage = (req, error = '') => ({
    title: 'A minha conta',
    active: 'conta',
    body: html`${pageHead('A minha conta', { sub: html`${req.user.name} · utilizador <span class="mono">${req.user.username}</span>` })}
      ${flash(req.query, req)}
      ${req.user.mustChangePassword ? html`<div class="notice warn"><p>Defina uma palavra-passe sua antes de continuar: <a href="#password">alterar palavra-passe</a>.</p></div>` : ''}
      ${error ? html`<div class="notice err" role="alert">${error}</div>` : ''}
      <section class="sec"><div class="sec-h"><h2>Aspeto</h2><span class="aside"><a href="/aparencia">Ver e escolher temas</a></span></div>
        <p class="sec-note">Tema atual: <b>${themeById(req.look.theme).name}</b>. O modo claro/escuro fica guardado neste dispositivo.</p>
        <form method="post" action="/aparencia/modo" class="toolbar">
          <input type="hidden" name="back" value="/conta">
          <span class="seg" role="radiogroup" aria-label="Modo neste dispositivo">${['auto', 'claro', 'escuro'].map((m) => html`<label><input type="radio" name="modo" value="${m}"${req.look.mode === m ? raw(' checked') : ''}> ${{ auto: 'Automático', claro: 'Claro', escuro: 'Escuro' }[m]}</label>`)}</span>
          <button class="btn" type="submit">Aplicar</button>
        </form>
      </section>
      <section class="sec" id="notificacoes"><div class="sec-h"><h2>Notificações</h2></div>
        <p class="sec-note">Aviso no telemóvel ou no computador quando o secretariado faz uma reserva ou pede uma alteração. Tem de ser ativado em cada dispositivo. As notificações só dizem o exame, a hora e quem reservou.</p>
        <div class="push-box" data-push>
          <p class="push-state" data-push-state>As notificações precisam de JavaScript e de a app ser aberta em HTTPS.</p>
          <div class="form-actions">
            <button type="button" class="btn primary" data-push-on hidden>Ativar neste dispositivo</button>
            <button type="button" class="btn" data-push-test hidden>Enviar teste</button>
            <button type="button" class="btn ghost" data-push-off hidden>Desativar neste dispositivo</button>
          </div>
        </div>
      </section>
      <section class="sec" id="password"><div class="sec-h"><h2>Alterar palavra-passe</h2></div>
        <form method="post" action="/conta" class="stack sheet narrow">
          <label>Palavra-passe atual<input type="password" name="current" autocomplete="current-password" required></label>
          <label>Nova palavra-passe <span class="opt">mínimo 10 caracteres; uma frase é mais fácil de lembrar</span><input type="password" name="password" autocomplete="new-password" minlength="10" required></label>
          <label>Repetir nova palavra-passe<input type="password" name="password2" autocomplete="new-password" minlength="10" required></label>
          <div><button class="btn primary" type="submit">Alterar palavra-passe</button></div>
        </form>
      </section>
      <section class="sec quiet" id="instalar" hidden><div class="sec-h"><h2>Instalar como app</h2></div>
        <p>Abre numa janela própria, sem barra do browser, e fica no menu Iniciar ou no ecrã principal.</p>
        <button type="button" class="btn" data-install>Instalar</button>
      </section>`,
  });

  app.get('/conta', async (req, reply) => send(reply, req, contaPage(req)));

  app.post('/conta', async (req, reply) => {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const current = str(req.body?.current);
    const pw = str(req.body?.password);
    if (!verifyPassword(current, row.password_hash)) return send(reply, req, contaPage(req, 'A palavra-passe atual está errada.'), 400);
    if (pw !== str(req.body?.password2)) return send(reply, req, contaPage(req, 'As duas palavras-passe não coincidem.'), 400);
    const weak = validatePasswordStrength(pw);
    if (weak) return send(reply, req, contaPage(req, weak), 400);
    if (pw === current) return send(reply, req, contaPage(req, 'A nova palavra-passe tem de ser diferente.'), 400);
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(pw), req.user.id);
      destroyUserSessions(db, req.user.id);
      audit(db, req.user.id, 'alterar_password', 'utilizador', req.user.id);
    })();
    const token = createSession(db, req.user.id);
    reply.header('set-cookie', sessionCookie(token, { secure: req.protocol === 'https', maxAgeSeconds: config.sessionIdleHours * 3600 * 3 }));
    return reply.redirect('/hoje?msg=password');
  });
}
