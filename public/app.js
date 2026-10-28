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
  document.querySelectorAll('form.report-form, form.form-grid, form.acts-form, form.ficha, form[action="/admin/horario"]').forEach(function (f) {
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

  // Reservas: a barra de confirmação resume a escolha (exame, dia e hora, quem reserva).
  document.querySelectorAll('[data-confirm-bar]').forEach(function (bar) {
    var form = bar.closest('form');
    var sum = bar.querySelector('[data-summary]');
    var exam = bar.getAttribute('data-exam');
    var update = function () {
      var r = form.querySelector('input[name="start"]:checked');
      var who = form.querySelector('[name="quem"]');
      var name = who && who.value ? ' · ' + (who.options ? who.options[who.selectedIndex].text : who.value) : '';
      bar.classList.toggle('ready', !!r);
      sum.textContent = r ? exam + ' · ' + r.getAttribute('data-label') + name : 'Escolha uma hora.';
    };
    form.addEventListener('change', update);
    update();
  });

  // Página de reservas: em modo automático, o botão oferece o contrário do que o sistema mostra.
  var mt = document.querySelector('[data-mode-toggle="auto"]');
  if (mt && window.matchMedia) {
    var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    mt.value = dark ? 'claro' : 'escuro';
    mt.setAttribute('aria-label', dark ? 'Mudar para modo claro' : 'Mudar para modo escuro');
    mt.classList.toggle('is-dark', dark);
    var ml = mt.querySelector('.mode-l');
    if (ml) ml.textContent = dark ? 'Claro' : 'Escuro';
  }

  // Datas dd/mm/aaaa: as barras aparecem sozinhas enquanto se escreve os números.
  document.querySelectorAll('input[data-date]').forEach(function (inp) {
    inp.addEventListener('input', function (ev) {
      if (ev.inputType && ev.inputType.indexOf('delete') === 0) return;
      var d = inp.value.replace(/\D/g, '').slice(0, 8);
      var out = d.slice(0, 2) + (d.length > 2 ? '/' + d.slice(2, 4) : '') + (d.length > 4 ? '/' + d.slice(4) : '');
      if (d.length === 2 || d.length === 4) out += '/';
      inp.value = out;
    });
  });

  // Ajuda «?»: só uma aberta de cada vez; fecha ao tocar fora ou com Esc.
  document.addEventListener('click', function (ev) {
    document.querySelectorAll('details.help[open]').forEach(function (d) { if (!d.contains(ev.target)) d.open = false; });
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') document.querySelectorAll('details.help[open]').forEach(function (d) { d.open = false; });
  });

  // Horário: copiar a segunda-feira para terça a sexta.
  var fill = document.querySelector('[data-fill-week]');
  if (fill) {
    fill.hidden = false;
    fill.addEventListener('click', function () {
      var src = document.querySelector('tr[data-day="1"]');
      if (!src) return;
      var vals = Array.prototype.map.call(src.querySelectorAll('select'), function (s) { return s.value; });
      ['2', '3', '4', '5'].forEach(function (d) {
        var row = document.querySelector('tr[data-day="' + d + '"]');
        if (row) row.querySelectorAll('select').forEach(function (s, i) { s.value = vals[i]; });
      });
      dirty = true;
    });
  }

  // Horário: a pré-visualização da semana acompanha as horas escolhidas, antes de guardar.
  var wp = document.querySelector('.week-preview[data-w]');
  if (wp) {
    var svg = wp.querySelector('svg');
    var num = function (k) { return Number(wp.getAttribute('data-' + k)); };
    var toM = function (t) { return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)); };
    var xOf = function (t) { return num('left') + ((toM(t) - num('h0')) / (num('h1') - num('h0'))) * (num('w') - num('left')); };
    var redraw = function () {
      svg.querySelectorAll('rect.wp-bar').forEach(function (r) { r.remove(); });
      var total = 0;
      document.querySelectorAll('tr[data-day]').forEach(function (tr) {
        var d = Number(tr.getAttribute('data-day'));
        var v = Array.prototype.map.call(tr.querySelectorAll('select'), function (s) { return s.value; });
        [[v[0], v[1]], [v[2], v[3]]].forEach(function (p) {
          if (!p[0] || !p[1] || toM(p[1]) <= toM(p[0])) return;
          total += toM(p[1]) - toM(p[0]);
          var r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          r.setAttribute('class', 'wp-bar');
          r.setAttribute('x', xOf(p[0]).toFixed(1));
          r.setAttribute('y', String(22 + (d - 1) * num('row') + 4));
          r.setAttribute('width', (xOf(p[1]) - xOf(p[0])).toFixed(1));
          r.setAttribute('height', String(num('row') - 10));
          r.setAttribute('rx', '3');
          svg.appendChild(r);
        });
      });
      var cap = wp.querySelector('[data-total]');
      if (cap) cap.textContent = (Math.round((total / 60) * 10) / 10).toString().replace('.', ',') + ' h de exames por semana';
    };
    document.querySelectorAll('tr[data-day] select').forEach(function (s) { s.addEventListener('change', redraw); });
    if (fill) fill.addEventListener('click', redraw);
  }

  // Ficha: mostra as opções (escolha) ou os normativos (número) conforme o tipo do parâmetro.
  document.querySelectorAll('select[data-type]').forEach(function (sel) {
    sel.addEventListener('change', function () { var tb = sel.closest('tbody.fp'); if (tb) tb.setAttribute('data-kind', sel.value); });
  });
  // Ficha: inserir um marcador {campo} na frase de técnica, onde está o cursor.
  var sentence = document.querySelector('textarea[data-sentence]');
  document.querySelectorAll('[data-insert]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      if (!sentence) return;
      var t = chip.getAttribute('data-insert');
      var a = sentence.selectionStart || sentence.value.length;
      var b = sentence.selectionEnd || a;
      sentence.value = sentence.value.slice(0, a) + t + sentence.value.slice(b);
      sentence.focus();
      sentence.selectionStart = sentence.selectionEnd = a + t.length;
      dirty = true;
    });
  });

  // Atos: os quadrados de «Ocupa» acompanham a duração escolhida.
  document.querySelectorAll('select[data-duration]').forEach(function (sel) {
    sel.addEventListener('change', function () {
      var row = sel.closest('tr');
      var box = row && row.querySelector('.blocks');
      if (!box) return;
      var n = Math.ceil(Number(sel.value) / Number(sel.getAttribute('data-step') || 15));
      box.textContent = '';
      for (var i = 0; i < Math.min(16, n); i++) box.appendChild(document.createElement('i'));
      if (n > 16) { var b = document.createElement('b'); b.textContent = '+' + (n - 16); box.appendChild(b); }
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
          say('A testar…');
          // 1) Garante que está ativo o service worker mais recente (os antigos não tratam notificações).
          reg.update().catch(function () {}).then(function () {
            // 2) Notificação local: se esta não aparecer, o problema é do browser/sistema, não da app.
            return reg.showNotification('Ortóptica — teste local', { body: 'Se vê isto, este dispositivo mostra notificações.', tag: 'teste-local' });
          }).then(function () {
            return post('/push/teste');
          }).then(function (r) {
            say(r.ok
              ? 'Devem aparecer duas notificações: «teste local» já, e outra enviada pelo servidor dentro de segundos. Se não aparecer nenhuma, as notificações do browser estão desligadas no sistema (Mac: Definições do Sistema → Notificações → Firefox; Windows: Definições → Sistema → Notificações) ou há um modo «Não incomodar» ativo.'
              : 'O serviço de notificações recusou o envio (' + (r.status || 'sem resposta') + '). Desative e volte a ativar neste dispositivo.');
          }).catch(function (e) {
            say('Este browser não deixou mostrar a notificação (' + (e && e.message ? e.message : 'erro') + '). Confirme a autorização nas definições do site.');
          }).finally(function () { testBtn.disabled = false; });
        });
      });
    }
  }
})();
