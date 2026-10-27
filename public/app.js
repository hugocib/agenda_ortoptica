// JavaScript mínimo: a app funciona sem ele. Só melhora a experiência.
(function () {
  'use strict';

  var netbar = document.getElementById('netbar');
  function showNet(msg) { if (netbar) { netbar.textContent = msg; netbar.hidden = !msg; } }

  // Confirmação antes de ações destrutivas (botões com data-confirm).
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-confirm]');
    if (btn && !window.confirm(btn.getAttribute('data-confirm'))) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }, true);

  // Antes de submeter formulários longos (relatório, novo pedido), confirma que o servidor
  // responde. Se não responder, o que foi escrito fica no ecrã em vez de se perder numa página
  // de erro do browser.
  function serverAlive() {
    var ctrl = 'AbortController' in window ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 4000);
    return fetch('/healthz', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { clearTimeout(timer); return r.ok; })
      .catch(function () { clearTimeout(timer); return false; });
  }

  function release(form) {
    form.dataset.submitting = '';
    form.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
  }

  // Evita submissões duplicadas (duplo clique). Os botões só são desativados depois de o
  // browser já ter lido o valor do botão clicado (setTimeout), para não o perder.
  document.addEventListener('submit', function (ev) {
    var form = ev.target;
    if (form.method && form.method.toLowerCase() === 'get') return;
    if (form.dataset.submitting === '1') { ev.preventDefault(); return; }

    if (form.classList.contains('guarded') && form.dataset.checked !== '1') {
      ev.preventDefault();
      var submitter = ev.submitter || null;
      form.dataset.submitting = '1';
      serverAlive().then(function (ok) {
        form.dataset.submitting = '';
        if (!ok) {
          showNet('Sem ligação ao servidor. Nada foi enviado e o que escreveu continua aqui. Tente de novo quando a ligação voltar.');
          return;
        }
        showNet('');
        form.dataset.checked = '1';
        if (form.requestSubmit) form.requestSubmit(submitter); else form.submit();
        form.dataset.checked = '';
      });
      return;
    }

    form.dataset.submitting = '1';
    setTimeout(function () {
      form.querySelectorAll('button[type="submit"], button:not([type])').forEach(function (b) { b.disabled = true; });
    }, 0);
    // Se a navegação falhar (servidor em baixo), volta a permitir.
    setTimeout(function () { release(form); }, 8000);
  });

  // Ao voltar atrás (bfcache), os botões não podem ficar presos em «desativado».
  window.addEventListener('pageshow', function (ev) {
    if (ev.persisted) document.querySelectorAll('form').forEach(release);
  });

  window.addEventListener('offline', function () { showNet('Sem rede. As ações só são guardadas quando a ligação voltar.'); });
  window.addEventListener('online', function () { showNet(''); });
  if (navigator.onLine === false) showNet('Sem rede. As ações só são guardadas quando a ligação voltar.');

  // Imprimir relatório.
  document.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-print]')) window.print();
  });

  // Copiar códigos (processo, SAP) para colar no Siima.
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-copy]');
    if (!btn || !navigator.clipboard) return;
    navigator.clipboard.writeText(btn.getAttribute('data-copy')).then(function () {
      btn.classList.add('copied');
      var label = btn.getAttribute('aria-label') || '';
      btn.setAttribute('aria-label', 'Copiado');
      setTimeout(function () { btn.classList.remove('copied'); btn.setAttribute('aria-label', label); }, 1400);
    });
  });

  // Relatório: assinala logo ↓ / ↑ quando o valor sai dos normativos do laboratório.
  function parseNum(s) {
    s = String(s || '').trim().replace(/\s/g, '').replace(',', '.');
    if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
    return Number(s);
  }
  function flag(input) {
    var out = input.parentNode.querySelector('.nflag');
    if (!out) return;
    var v = parseNum(input.value);
    var min = input.hasAttribute('data-min') ? Number(input.getAttribute('data-min')) : null;
    var max = input.hasAttribute('data-max') ? Number(input.getAttribute('data-max')) : null;
    var f = '';
    if (v !== null && min !== null && v < min) f = '↓';
    else if (v !== null && max !== null && v > max) f = '↑';
    out.textContent = f;
    out.title = f === '↓' ? 'Abaixo do normativo' : f === '↑' ? 'Acima do normativo' : '';
  }
  document.querySelectorAll('input[data-min], input[data-max]').forEach(function (i) {
    flag(i);
    i.addEventListener('input', function () { flag(i); });
  });

  // Páginas de trabalho diário: recarregar ao voltar ao separador se passaram >5 min,
  // para não decidir com uma lista desatualizada. Nunca recarrega a meio de escrita.
  var refresh = document.body.getAttribute('data-autorefresh');
  if (refresh) {
    var loadedAt = Date.now();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && Date.now() - loadedAt > Number(refresh) * 1000) {
        var active = document.activeElement;
        if (!active || !/INPUT|TEXTAREA|SELECT/.test(active.tagName)) window.location.reload();
      }
    });
  }

  // Aviso ao sair de um formulário com alterações por guardar (relatório, pedido).
  var dirty = false;
  document.querySelectorAll('form.report-form, form.form-grid').forEach(function (f) {
    f.addEventListener('input', function () { dirty = true; });
    f.addEventListener('submit', function () { dirty = false; });
  });
  window.addEventListener('beforeunload', function (ev) {
    if (dirty) { ev.preventDefault(); ev.returnValue = ''; }
  });

  // Instalação: só um botão discreto na página «A minha conta», e só se o browser o permitir.
  var installEvent = null;
  window.addEventListener('beforeinstallprompt', function (ev) {
    ev.preventDefault();
    installEvent = ev;
    var box = document.getElementById('instalar');
    if (box) box.hidden = false;
  });
  document.addEventListener('click', function (ev) {
    if (!ev.target.closest('[data-install]') || !installEvent) return;
    installEvent.prompt();
    installEvent.userChoice.finally(function () {
      installEvent = null;
      var box = document.getElementById('instalar');
      if (box) box.hidden = true;
    });
  });

  // Selecionar um valor já mostra o resultado (ex.: tipo de exame na página de reservas).
  document.querySelectorAll('select[data-autosubmit]').forEach(function (s) {
    s.addEventListener('change', function () { if (s.form) s.form.submit(); });
  });

  var swReady = null;
  if ('serviceWorker' in navigator && window.isSecureContext) {
    swReady = navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; })
      .catch(function () { return null; /* sem PWA: a app continua a funcionar */ });
  }

  // Notificações push (página «A minha conta»).
  var pushBox = document.querySelector('[data-push]');
  if (pushBox) {
    var stateEl = pushBox.querySelector('[data-push-state]');
    var onBtn = pushBox.querySelector('[data-push-on]');
    var offBtn = pushBox.querySelector('[data-push-off]');
    var testBtn = pushBox.querySelector('[data-push-test]');
    var say = function (t) { stateEl.textContent = t; };
    var show = function (subscribed) {
      onBtn.hidden = subscribed || Notification.permission === 'denied'; offBtn.hidden = !subscribed; testBtn.hidden = !subscribed;
      say(subscribed ? 'Ativas neste dispositivo.' : Notification.permission === 'denied'
        ? 'Bloqueadas neste browser. Autorize as notificações nas definições do site e recarregue a página.'
        : 'Desativadas neste dispositivo.');
    };
    var post = function (url, body) {
      return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
    };
    var b64 = function (s) {
      var pad = '='.repeat((4 - (s.length % 4)) % 4);
      var raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
      var out = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    };
    if (!window.isSecureContext) say('Só funcionam com a app aberta em HTTPS (pelo endereço do Nginx Proxy Manager).');
    else if (!swReady || !('PushManager' in window) || !('Notification' in window)) say('Este browser não suporta notificações push. No iPhone, instale primeiro a app no ecrã principal.');
    else {
      swReady.then(function (reg) {
        if (!reg) { say('Não foi possível ativar o service worker.'); return; }
        reg.pushManager.getSubscription().then(function (sub) { show(!!sub); });
        onBtn.addEventListener('click', function () {
          onBtn.disabled = true;
          Notification.requestPermission().then(function (perm) {
            if (perm !== 'granted') { show(false); return null; }
            return fetch('/push/chave', { credentials: 'same-origin' }).then(function (r) { return r.json(); })
              .then(function (k) { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(k.key) }); })
              .then(function (sub) { return post('/push/subscrever', sub.toJSON()); })
              .then(function () { show(true); });
          }).catch(function () { say('Não foi possível ativar. Tente de novo.'); })
            .finally(function () { onBtn.disabled = false; });
        });
        offBtn.addEventListener('click', function () {
          reg.pushManager.getSubscription().then(function (sub) {
            if (!sub) return show(false);
            return post('/push/cancelar', { endpoint: sub.endpoint }).catch(function () {}).then(function () { return sub.unsubscribe(); }).then(function () { show(false); });
          });
        });
        testBtn.addEventListener('click', function () {
          testBtn.disabled = true;
          post('/push/teste').then(function (r) { say(r.ok ? 'Teste enviado. Deve aparecer dentro de segundos.' : 'O servidor não conseguiu enviar. Veja os registos do servidor.'); })
            .catch(function () { say('O servidor não respondeu.'); })
            .finally(function () { testBtn.disabled = false; });
        });
      });
    }
  }
})();
