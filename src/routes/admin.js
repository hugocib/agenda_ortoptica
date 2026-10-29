import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { html, raw } from '../html.js';
import { audit, getSetting, setSetting } from '../db.js';
import { destroyUserSessions, generatePassword, hashPassword } from '../auth.js';
import { isBackupName, listBackups, runBackup } from '../backup.js';
import { formFromTemplate, numericFields, parseForm } from '../domain/reports.js';
import fichaRoutes from './ficha.js';
import { THEME_IDS, THEMES } from '../themes.js';
import { isTime, toMin } from '../time.js';
import { flash, help, icon, pageHead, timeSelect } from '../ui.js';
import { forbid, idParam, isOrtho, send, str } from './util.js';

const WEEKDAYS = [[1, 'Segunda'], [2, 'Terça'], [3, 'Quarta'], [4, 'Quinta'], [5, 'Sexta'], [6, 'Sábado']];

function tabs(active) {
  const t = (href, label, key) => html`<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
  return html`<nav class="tabs">${t('/admin', 'Horário', 'geral')}${t('/admin/exames', 'Atos / MCDTs', 'exames')}${t('/admin/reservas', 'Reservas', 'reservas')}${t('/admin/utilizadores', 'Utilizadores', 'users')}${t('/admin/sistema', 'Sistema', 'sistema')}</nav>`;
}

/** Janelas de um dia em manhã (começa antes das 13:00) e tarde (a seguinte). */
function splitDay(availability, wd) {
  const ws = availability.filter((w) => w.weekday === wd).sort((a, c) => a.start.localeCompare(c.start));
  const m = ws.find((w) => w.start < '13:00') || null;
  const t = ws.find((w) => w !== m) || null;
  return { m, t };
}

/** Pré-visualização da semana: barras de manhã e tarde numa régua das 07:00 às 21:00. */
function weekPreview(availability) {
  const H0 = 7 * 60; const H1 = 21 * 60; const W = 500; const ROW = 26; const LEFT = 34;
  const x = (t) => LEFT + ((toMin(t) - H0) / (H1 - H0)) * (W - LEFT);
  const ticks = [];
  for (let h = 7; h <= 21; h += 1) ticks.push(h);
  const rows = WEEKDAYS.map(([n, label], i) => {
    const y = 22 + i * ROW;
    const bars = availability.filter((w) => w.weekday === n).map((w) => `<rect class="wp-bar" data-day="${n}" x="${x(w.start).toFixed(1)}" y="${y + 4}" width="${(x(w.end) - x(w.start)).toFixed(1)}" height="${ROW - 10}" rx="3"/>`).join('');
    return `<text class="wp-day" x="0" y="${y + ROW / 2 + 3}">${label.slice(0, 3)}</text><line class="wp-row" x1="${LEFT}" x2="${W}" y1="${y + ROW / 2}" y2="${y + ROW / 2}"/>${bars}`;
  }).join('');
  const grid = ticks.map((h) => `<line class="wp-tick" x1="${x(`${String(h).padStart(2, '0')}:00`)}" x2="${x(`${String(h).padStart(2, '0')}:00`)}" y1="16" y2="${22 + WEEKDAYS.length * ROW}"/>${h % 2 === 1 ? `<text class="wp-hour" x="${x(`${String(h).padStart(2, '0')}:00`)}" y="11">${h}h</text>` : ''}`).join('');
  const total = availability.reduce((a, w) => a + toMin(w.end) - toMin(w.start), 0);
  return html`<figure class="week-preview" data-h0="${H0}" data-h1="${H1}" data-w="${W}" data-left="${LEFT}" data-row="${ROW}"><svg viewBox="0 0 ${W + 14} ${30 + WEEKDAYS.length * ROW}" role="img" aria-label="Semana: ${Math.round(total / 60)} horas de exames">${raw(grid + rows)}</svg>
    <figcaption data-total>${Math.round((total / 60) * 10) / 10} h de exames por semana${availability.length ? '' : ' · sem horário definido'}</figcaption></figure>`;
}

/** Resumo da ficha na tabela de atos, com ligação ao editor. */
function fichaCell(t) {
  const form = parseForm(t.form);
  const params = form.sections.reduce((a, sec) => a + sec.fields.length, 0);
  const withNorms = numericFields(form).filter((f) => f.norms.some((n) => n.min != null || n.max != null)).length;
  return html`<a class="ficha-link" href="/admin/exames/${t.id}/ficha">Ficha<small>${params} ${params === 1 ? 'parâmetro' : 'parâmetros'}${withNorms ? ` · ${withNorms} com normativo` : ''}</small></a>`;
}

const fmtMin = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`);

export default async function adminRoutes(app, { db, config }) {
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/admin') && !isOrtho(req)) return forbid(reply);
  });

  // ---------- Horário ----------
  app.get('/admin', async (req, reply) => {
    const availability = getSetting(db, 'availability');
    const step = getSetting(db, 'slot_step_min');
    const horizon = getSetting(db, 'horizon_weeks');
    const byDay = Object.fromEntries(WEEKDAYS.map(([n]) => [n, splitDay(availability, n)]));
    return send(reply, req, {
      title: 'Horário',
      active: 'admin',
      body: html`${pageHead('Administração')}${tabs('geral')}${flash(req.query, req)}
        <form method="post" action="/admin/horario">
          <section class="sec"><div class="sec-h"><h2>Horário de exames</h2>${help(html`<p>Escolha «—» nos períodos sem exames.</p><p>O intervalo entre a manhã e a tarde é o almoço: nunca tem vagas.</p><p>Mudar o horário não mexe nos exames já marcados.</p>`)}
            <span class="aside"><button type="button" class="btn link" data-fill-week hidden>Copiar segunda para os outros dias úteis</button></span></div>
            <div class="sched"><table class="week-grid">
              <thead><tr><th scope="col"><span class="sr">Dia</span></th><th scope="col" colspan="3">Manhã</th><th scope="col" colspan="3">Tarde</th></tr></thead>
              <tbody>${WEEKDAYS.map(([n, label]) => {
                const d = byDay[n];
                return html`<tr data-day="${n}"><th scope="row">${label}</th>
                  <td>${timeSelect(`m_start_${n}`, d.m?.start, { from: '07:00', to: '14:00', label: `${label}, manhã, início` })}</td><td class="dash" aria-hidden="true">–</td>
                  <td>${timeSelect(`m_end_${n}`, d.m?.end, { from: '08:00', to: '15:00', label: `${label}, manhã, fim` })}</td>
                  <td>${timeSelect(`t_start_${n}`, d.t?.start, { from: '12:00', to: '20:00', label: `${label}, tarde, início` })}</td><td class="dash" aria-hidden="true">–</td>
                  <td>${timeSelect(`t_end_${n}`, d.t?.end, { from: '13:00', to: '21:00', label: `${label}, tarde, fim` })}</td></tr>`;
              })}</tbody>
            </table>
            ${weekPreview(availability)}</div>
          </section>
          <section class="sec"><div class="sec-h"><h2>Marcação</h2></div>
            <div class="settings-row">
              <label>Grelha ${help(html`<p>Intervalo entre as horas de início possíveis.</p><p>A duração de cada ato é arredondada para cima a esta grelha (com 15 min, um ato de 20 min ocupa 30).</p>`)}
                <select name="slot_step_min">${[5, 10, 15, 20, 30].map((n) => html`<option value="${n}"${step === n ? raw(' selected') : ''}>${n} min</option>`)}</select></label>
              <label>Vagas visíveis ${help('Quantas semanas à frente o secretariado (e a página «Agendar») mostram.')}
                <select name="horizon_weeks">${[1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 26].map((n) => html`<option value="${n}"${horizon === n ? raw(' selected') : ''}>${n} ${n === 1 ? 'semana' : 'semanas'}</option>`)}</select></label>
            </div>
            <p class="muted small">O máximo de exames por dia define-se em cada ato, em <a href="/admin/exames">Atos / MCDTs</a>.</p>
          </section>
          <div class="form-actions"><button class="btn primary" type="submit">Guardar horário</button></div>
        </form>`,
    });
  });

  app.post('/admin/horario', async (req, reply) => {
    const b = req.body || {};
    const windows = [];
    for (const [n] of WEEKDAYS) {
      const pairs = [[str(b[`m_start_${n}`]), str(b[`m_end_${n}`])], [str(b[`t_start_${n}`]), str(b[`t_end_${n}`])]];
      let lastEnd = '';
      for (const [st, en] of pairs) {
        if (!st && !en) continue;
        if (!isTime(st) || !isTime(en) || toMin(en) <= toMin(st) || (lastEnd && st < lastEnd)) return reply.redirect('/admin?err=horario');
        windows.push({ weekday: n, start: st, end: en });
        lastEnd = en;
      }
    }
    const step = Number(str(b.slot_step_min));
    const horizon = Number(str(b.horizon_weeks));
    if (![5, 10, 15, 20, 30].includes(step) || !(horizon >= 1 && horizon <= 26)) return reply.redirect('/admin?err=dados_invalidos');
    db.transaction(() => {
      setSetting(db, 'availability', windows);
      setSetting(db, 'slot_step_min', step);
      setSetting(db, 'horizon_weeks', Math.trunc(horizon));
      audit(db, req.user.id, 'alterar_horario', 'definicoes', null, { windows, step, horizon });
    })();
    return reply.redirect('/admin?msg=guardado');
  });

  // ---------- Secretariado (link de reservas) ----------
  app.get('/admin/reservas', async (req, reply) => {
    const bookingUrl = `${req.protocol}://${req.headers.host}/r/${getSetting(db, 'booking_token')}`;
    const names = getSetting(db, 'booking_names') || [];
    const bookingTheme = getSetting(db, 'booking_theme');
    return send(reply, req, {
      title: 'Reservas',
      active: 'admin',
      body: html`${pageHead('Administração')}${tabs('reservas')}${flash(req.query, req)}
        <section class="sec"><div class="sec-h"><h2>Link de reservas</h2>${help(html`<p>Envie este endereço ao secretariado. Quem o tiver vê as vagas livres e reserva, sem conta nem dados de doentes.</p><p>As reservas ficam por confirmar até as confirmar em «Hoje».</p>`)}</div>
          <p class="link-row"><button type="button" class="copy" data-copy="${bookingUrl}" aria-label="Copiar link de reservas">${bookingUrl}${icon('copiar', 'ico xs')}</button>
            <a class="btn ghost" href="${bookingUrl}" target="_blank" rel="noopener">Abrir</a>
            <form method="post" action="/admin/reservas/link" class="inline"><button class="btn" data-confirm="Criar um link novo? O atual deixa de funcionar e terá de enviar o novo ao secretariado.">Gerar link novo</button></form></p>
        </section>
        <section class="sec"><div class="sec-h"><h2>Aspeto da página</h2>${help('A página de reservas tem um tema fixo, para não mudar quando muda o seu. Cada secretária escolhe claro ou escuro no próprio browser (botão no topo da página).')}</div>
          <form method="post" action="/admin/reservas/tema" class="toolbar">
            <label>Tema <select name="theme">${THEMES.map((t) => html`<option value="${t.id}"${t.id === bookingTheme ? raw(' selected') : ''}>${t.name}</option>`)}</select></label>
            <button class="btn" type="submit">Guardar</button>
            <a href="/aparencia">Ver os temas</a>
          </form>
        </section>
        <section class="sec"><div class="sec-h"><h2>Quem reserva</h2>${help('Um nome por linha. Aparecem numa lista ao reservar. Se ficar vazio, escrevem o nome.')}</div>
          <form method="post" action="/admin/reservas" class="stack narrow-form">
            <textarea name="booking_names" rows="5" maxlength="800" aria-label="Nomes de quem reserva, um por linha">${names.join('\n')}</textarea>
            <div><button class="btn primary" type="submit">Guardar nomes</button></div>
          </form>
        </section>`,
    });
  });

  // ---------- Sistema ----------
  app.get('/admin/sistema', async (req, reply) => {
    const header = getSetting(db, 'report_header');
    const logo = getSetting(db, 'report_logo');
    const icsUrl = `${req.protocol}://${req.headers.host}/ics/${getSetting(db, 'ics_token')}/agenda.ics`;
    const backups = listBackups(config.backupDir).slice(0, 15);
    return send(reply, req, {
      title: 'Sistema',
      active: 'admin',
      body: html`${pageHead('Administração')}${tabs('sistema')}${flash(req.query, req)}
        <section class="sec"><div class="sec-h"><h2>Relatórios</h2>${help('Cabeçalho, logotipo e assinatura que aparecem em todos os relatórios. Os já validados não mudam.')}</div>
          <form method="post" action="/admin/relatorio" class="stack">
            <label>Cabeçalho <span class="opt">uma linha por linha</span><textarea name="report_header" rows="3" maxlength="600">${header.join('\n')}</textarea></label>
            <div class="grid3">
              <label>Função de quem assina<input name="report_signer" maxlength="80" value="${getSetting(db, 'report_signer')}"></label>
              <label>Identificação profissional<input name="report_signer_id" maxlength="120" value="${getSetting(db, 'report_signer_id')}"></label>
              <label class="check"><input type="checkbox" name="report_medical_line" value="1"${getSetting(db, 'report_medical_line') ? html` checked` : ''}> <span>Linha de assinatura médica</span></label>
            </div>
            <div><button class="btn primary" type="submit">Guardar</button></div>
          </form>
          <h3 class="day-label" id="logotipo">Logotipo</h3>
          <div class="logo-row">
            <div class="logo-prev">${logo ? html`<img src="${logo}" alt="Logotipo atual">` : html`<span class="muted">Sem logotipo</span>`}</div>
            <form method="post" action="/admin/relatorio/logo" class="logo-form" data-logo-form>
              <input type="hidden" name="logo" value="">
              <label class="btn"><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" data-logo-file class="sr-file">${logo ? 'Trocar imagem…' : 'Escolher imagem…'}</label>
              <span class="muted small" data-logo-name>PNG, JPG, WebP ou SVG, até 200 KB. Aparece no canto do cabeçalho.</span>
              <noscript><span class="small">Precisa de JavaScript para carregar a imagem.</span></noscript>
            </form>
            ${logo ? html`<form method="post" action="/admin/relatorio/logo/remover" class="inline"><button class="btn ghost" data-confirm="Remover o logotipo dos relatórios? Os já validados não mudam.">Remover</button></form>` : ''}
          </div>
        </section>
        <section class="sec"><div class="sec-h"><h2>Calendário (ICS)</h2>${help('Subscreva no Outlook ou no telemóvel para ver os exames marcados. Só mostra o tipo de exame e a hora, sem dados de doentes.')}</div>
          <p class="link-row"><button type="button" class="copy" data-copy="${icsUrl}" aria-label="Copiar endereço do calendário">${icsUrl}${icon('copiar', 'ico xs')}</button>
            <form method="post" action="/admin/ics" class="inline"><button class="btn" data-confirm="Criar novo endereço? O atual deixa de funcionar.">Gerar novo endereço</button></form></p>
        </section>
        <section class="sec"><div class="sec-h"><h2>Cópias de segurança</h2>${help(html`Automáticas a cada ${config.backupEveryHours} h; guardam-se as últimas ${config.backupKeep}. Pasta no servidor: <code>${config.backupDir}</code>.`)}
            <span class="aside"><form method="post" action="/admin/backups" class="inline"><button class="btn">Fazer cópia agora</button></form></span></div>
          ${backups.length ? html`<table class="table"><thead><tr><th>Ficheiro</th><th>Tamanho</th><th></th></tr></thead><tbody>
            ${backups.map((bk) => html`<tr><td><code>${bk.name}</code></td><td>${(bk.size / 1024).toFixed(0)} KB</td><td class="right"><a href="/admin/backups/${bk.name}">Descarregar</a></td></tr>`)}
          </tbody></table>` : html`<p class="notice warn">Ainda não há cópias de segurança.</p>`}
        </section>`,
    });
  });

  app.post('/admin/relatorio', async (req, reply) => {
    const b = req.body || {};
    const header = str(b.report_header).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 6).map((l) => l.slice(0, 120));
    db.transaction(() => {
      setSetting(db, 'report_header', header);
      setSetting(db, 'report_signer', str(b.report_signer).trim().slice(0, 80));
      setSetting(db, 'report_signer_id', str(b.report_signer_id).trim().slice(0, 120));
      setSetting(db, 'report_medical_line', str(b.report_medical_line) === '1');
      audit(db, req.user.id, 'alterar_relatorio', 'definicoes');
    })();
    return reply.redirect('/admin/sistema?msg=guardado');
  });

  // Logotipo: o browser lê o ficheiro e envia-o como data URL (sem dependências de multipart).
  app.post('/admin/relatorio/logo', { bodyLimit: 400 * 1024 }, async (req, reply) => {
    const v = str(req.body?.logo);
    const m = /^data:image\/(png|jpeg|webp|svg\+xml);base64,([A-Za-z0-9+/=]+)$/.exec(v);
    const bytes = m ? Buffer.from(m[2], 'base64') : null;
    const okSvg = (b) => /<svg[\s>]/i.test(b.toString('utf8')) && !/<script|on[a-z]+\s*=|javascript:/i.test(b.toString('utf8'));
    if (!m || !bytes.length || bytes.length > 200 * 1024 || (m[1] === 'svg+xml' && !okSvg(bytes))) return reply.redirect('/admin/sistema?err=logo_invalido#logotipo');
    setSetting(db, 'report_logo', v);
    audit(db, req.user.id, 'logotipo', 'definicoes', null, { tipo: m[1], bytes: bytes.length });
    return reply.redirect('/admin/sistema?msg=logo#logotipo');
  });

  app.post('/admin/relatorio/logo/remover', async (req, reply) => {
    setSetting(db, 'report_logo', '');
    audit(db, req.user.id, 'logotipo_removido', 'definicoes');
    return reply.redirect('/admin/sistema?msg=logo_removido#logotipo');
  });

  app.post('/admin/reservas', async (req, reply) => {
    const names = [...new Set(str(req.body?.booking_names).split(/\r?\n/).map((l) => l.trim().slice(0, 60)).filter((l) => l.length >= 2))].slice(0, 30);
    setSetting(db, 'booking_names', names);
    audit(db, req.user.id, 'alterar_nomes_reserva', 'definicoes', null, { n: names.length });
    return reply.redirect('/admin/reservas?msg=guardado');
  });

  app.post('/admin/reservas/tema', async (req, reply) => {
    const id = str(req.body?.theme);
    if (!THEME_IDS.includes(id)) return reply.redirect('/admin/reservas?err=dados_invalidos');
    setSetting(db, 'booking_theme', id);
    audit(db, req.user.id, 'tema_reservas', 'definicoes', null, { tema: id });
    return reply.redirect('/admin/reservas?msg=guardado');
  });

  app.post('/admin/reservas/link', async (req, reply) => {
    setSetting(db, 'booking_token', crypto.randomBytes(18).toString('base64url'));
    audit(db, req.user.id, 'regenerar_link_reservas', 'definicoes');
    return reply.redirect('/admin/reservas?msg=link');
  });

  app.post('/admin/ics', async (req, reply) => {
    setSetting(db, 'ics_token', crypto.randomBytes(24).toString('base64url'));
    audit(db, req.user.id, 'regenerar_ics', 'definicoes');
    return reply.redirect('/admin/sistema?msg=ics');
  });

  app.post('/admin/backups', async (req, reply) => {
    try {
      const name = await runBackup(db, config.backupDir, config.backupKeep);
      audit(db, req.user.id, 'backup', 'definicoes', null, { name });
      return reply.redirect('/admin/sistema?msg=backup');
    } catch (err) {
      req.log.error({ err }, 'backup manual falhou');
      return reply.redirect('/admin/sistema?err=backup');
    }
  });

  app.get('/admin/backups/:name', async (req, reply) => {
    const name = String(req.params.name);
    if (!isBackupName(name)) return reply.callNotFound();
    const file = path.join(config.backupDir, name);
    if (!fs.existsSync(file)) return reply.callNotFound();
    audit(db, req.user.id, 'descarregar_backup', 'definicoes', null, { name });
    return reply.type('application/octet-stream').header('Content-Disposition', `attachment; filename="${name}"`).header('Cache-Control', 'no-store').send(fs.createReadStream(file));
  });

  // ---------- Atos / MCDTs ----------
  app.get('/admin/exames', async (req, reply) => {
    const types = db.prepare('SELECT * FROM exam_types ORDER BY active DESC, sort, name').all();
    const step = getSetting(db, 'slot_step_min');
    const durations = (current) => {
      const opts = [];
      for (let m = step; m <= 240; m += step) opts.push(m);
      for (const m of [270, 300, 360, 420, 480]) if (m % step === 0) opts.push(m);
      if (current && !opts.includes(current)) { opts.push(current); opts.sort((a, c) => a - c); }
      return opts;
    };
    const durSelect = (name, value, label) => html`<select name="${name}" class="dur-sel" data-duration data-step="${step}" aria-label="${label}">${durations(value).map((m) => html`<option value="${m}"${m === value ? raw(' selected') : ''}>${fmtMin(m)}</option>`)}</select>`;
    const blocks = (min) => html`<span class="blocks" aria-hidden="true">${Array.from({ length: Math.min(16, Math.ceil(min / step)) }, () => html`<i></i>`)}${Math.ceil(min / step) > 16 ? html`<b>+${Math.ceil(min / step) - 16}</b>` : ''}</span>`;
    const actsTable = (rows, research) => html`<table class="acts${research ? ' research' : ''}">
              <thead><tr><th scope="col">${research ? 'Avaliação' : 'Ato'}</th><th scope="col">Duração</th><th scope="col" class="hide-m">Ocupa</th><th scope="col">${research ? '' : 'Máx./dia'}</th><th scope="col">${research ? 'Ficha de resultados' : 'Ficha do relatório'}</th><th scope="col">Ativo</th></tr></thead>
              <tbody>${rows.map((t) => html`<tr class="${t.active ? '' : 'inactive'}">
                <td><input name="name.${t.id}" value="${t.name}" required maxlength="120" aria-label="Nome"></td>
                <td>${durSelect(`minutes.${t.id}`, t.minutes, `Duração de ${t.name}`)}</td>
                <td class="hide-m">${blocks(t.minutes)}</td>
                <td>${research ? html`<input type="hidden" name="max.${t.id}" value="">` : html`<select name="max.${t.id}" class="max-sel" aria-label="Máximo por dia de ${t.name}"><option value="">—</option>${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => html`<option${t.max_per_day === n ? raw(' selected') : ''}>${n}</option>`)}</select>`}</td>
                <td>${fichaCell(t)}</td>
                <td class="center"><input type="checkbox" name="active.${t.id}" value="1"${t.active ? raw(' checked') : ''} aria-label="${t.name} ativo"></td>
              </tr>`)}</tbody>
            </table>`;
    return send(reply, req, {
      title: 'Atos / MCDTs',
      active: 'admin',
      body: html`${pageHead('Administração')}${tabs('exames')}${flash(req.query, req)}
        <section class="sec"><div class="sec-h"><h2>Atos / MCDTs clínicos</h2>${help(html`<p><b>Duração</b>: tempo total do ato, com preparação. É o que cada reserva ocupa na agenda. Cada quadrado = ${step} min da grelha.</p><p><b>Máx./dia</b>: limite de exames desse ato no mesmo dia (p. ex. eletrofisiologia). «—» = sem limite.</p><p>Mudar a duração não altera exames já marcados. Para deixar de usar um ato, desmarque «Ativo» em vez de o apagar.</p>`)}</div>
          <form method="post" action="/admin/exames" class="acts-form">
            ${actsTable(types.filter((t) => t.kind !== 'investigacao'), false)}
            <div class="sec-h sub-h" id="investigacao"><h2>Avaliações de investigação</h2>${help(html`<p>Tipos de avaliação para participantes de projetos. Marcam-se em <a href="/investigacao/nova">Nova avaliação de investigação</a>, a qualquer hora, e nunca aparecem no link do secretariado.</p><p>Cada tipo tem a sua ficha de resultados, como os atos clínicos.</p>`)}</div>
            ${types.some((t) => t.kind === 'investigacao') ? actsTable(types.filter((t) => t.kind === 'investigacao'), true) : html`<p class="empty">Ainda não há. Crie um em «Novo ato ou avaliação», abaixo.</p>`}
            <div class="form-actions sticky-bar"><button class="btn primary" type="submit">Guardar alterações</button></div>
          </form>
        </section>
        <section class="sec quiet"><div class="sec-h"><h2>Novo ato ou avaliação</h2></div>
          <form method="post" action="/admin/exames/novo" class="toolbar">
            <label>Tipo <select name="kind"><option value="clinico">Ato / MCDT clínico</option><option value="investigacao"${req.query.tipo === 'investigacao' ? raw(' selected') : ''}>Avaliação de investigação</option></select></label>
            <label>Nome<input name="name" required maxlength="120" placeholder="p. ex. Campo visual"></label>
            <label>Duração ${durSelect('minutes', 30, 'Duração')}</label>
            <label>Ficha <select name="from"><option value="">em branco</option>${types.map((t) => html`<option value="${t.id}">cópia de ${t.name}</option>`)}</select></label>
            <button class="btn" type="submit">Adicionar e abrir a ficha</button>
          </form>
        </section>`,
    });
  });

  app.post('/admin/exames', async (req, reply) => {
    const b = req.body || {};
    const types = db.prepare('SELECT * FROM exam_types').all();
    const rows = [];
    for (const t of types) {
      if (b[`name.${t.id}`] === undefined) continue;
      const name = str(b[`name.${t.id}`]).trim().slice(0, 120);
      const minutes = Number.parseInt(str(b[`minutes.${t.id}`]), 10);
      const maxRaw = str(b[`max.${t.id}`]);
      const max = maxRaw === '' ? null : Number.parseInt(maxRaw, 10);
      if (name.length < 2 || !(minutes >= 5 && minutes <= 480) || (max !== null && !(max >= 1 && max <= 20))) {
        return reply.redirect('/admin/exames?err=dados_invalidos');
      }
      rows.push({ id: t.id, name, minutes, max, active: str(b[`active.${t.id}`]) === '1' ? 1 : 0 });
    }
    db.transaction(() => {
      const up = db.prepare('UPDATE exam_types SET name = @name, minutes = @minutes, max_per_day = @max, active = @active WHERE id = @id');
      for (const r of rows) up.run(r);
      audit(db, req.user.id, 'alterar', 'tipo_exame', null, { n: rows.length });
    })();
    return reply.redirect('/admin/exames?msg=guardado');
  });

  app.post('/admin/exames/novo', async (req, reply) => {
    const name = str(req.body?.name).trim().slice(0, 120);
    const minutes = Number.parseInt(str(req.body?.minutes), 10);
    if (name.length < 2 || !(minutes >= 5 && minutes <= 480)) return reply.redirect('/admin/exames?err=dados_invalidos');
    const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 FROM exam_types').pluck().get();
    const src = db.prepare('SELECT form FROM exam_types WHERE id = ?').get(Number(str(req.body?.from)) || 0);
    const form = src ? parseForm(src.form) : { ...formFromTemplate('generico'), title: name };
    const kind = str(req.body?.kind) === 'investigacao' ? 'investigacao' : 'clinico';
    const info = db.prepare(`INSERT INTO exam_types (code, name, minutes, is_electro, report_template, active, sort, form, kind)
      VALUES (?, ?, ?, 0, 'generico', 1, ?, ?, ?)`).run(`t${crypto.randomBytes(4).toString('hex')}`, name, minutes, sort, JSON.stringify(form), kind);
    const id = Number(info.lastInsertRowid);
    audit(db, req.user.id, 'criar', 'tipo_exame', id);
    return reply.redirect(`/admin/exames/${id}/ficha?msg=guardado`);
  });

  // ---------- Utilizadores ----------
  const usersPage = (req, extra = '') => {
    const users = db.prepare('SELECT * FROM users ORDER BY active DESC, display_name').all();
    return {
      title: 'Utilizadores',
      active: 'admin',
      body: html`${pageHead('Administração')}${tabs('users')}${flash(req.query, req)}${extra}
        <section class="sec">
          <table class="table rt"><thead><tr><th>Nome</th><th>Utilizador</th><th>Perfil</th><th>Estado</th><th></th></tr></thead><tbody>
          ${users.map((u) => html`<tr class="${u.active ? '' : 'inactive'}"><td>${u.display_name}</td><td>${u.username}</td><td>${u.role === 'ortoptista' ? 'Ortoptista' : 'Secretariado'}</td>
            <td>${u.active ? (u.must_change_password ? 'a aguardar 1.º acesso' : 'ativo') : 'inativo'}</td>
            <td class="act"><div class="actions">
              ${u.id !== req.user.id ? html`<form method="post" action="/admin/utilizadores/${u.id}/reset" class="inline"><button class="btn" data-confirm="Gerar nova palavra-passe temporária para ${u.display_name}?">Nova palavra-passe</button></form>
              <form method="post" action="/admin/utilizadores/${u.id}/ativo" class="inline"><button class="btn ${u.active ? 'danger' : ''}">${u.active ? 'Desativar' : 'Reativar'}</button></form>` : html`<span class="muted">(você)</span>`}
            </div></td></tr>`)}
          </tbody></table>
        </section>
        <section class="sec"><div class="sec-h"><h2>Novo utilizador</h2></div><div class="sheet narrow">
          <form method="post" action="/admin/utilizadores" class="stack">
            <label>Nome<input name="display_name" required maxlength="80"></label>
            <label>Utilizador (para entrar)<input name="username" required maxlength="40" pattern="[A-Za-z0-9._-]+" autocomplete="off"></label>
            <input type="hidden" name="role" value="ortoptista">
            <button class="btn primary" type="submit">Criar</button>
          </form>
          <p class="muted small">Contas só para ortoptistas: o secretariado usa o link de reservas. É gerada uma palavra-passe temporária, mostrada uma única vez; no primeiro acesso a pessoa define a sua.</p>
        </div></section>`,
    };
  };
  const tempPasswordBox = (who, pw) => html`<div class="notice warn"><strong>Palavra-passe temporária de ${who}:</strong> <code class="big-code">${pw}</code><br>Entregue-a pessoalmente; não volta a ser mostrada.</div>`;

  app.get('/admin/utilizadores', async (req, reply) => send(reply, req, usersPage(req)));

  app.post('/admin/utilizadores', async (req, reply) => {
    const b = req.body || {};
    const name = str(b.display_name).trim().slice(0, 80);
    const username = str(b.username).trim();
    const role = str(b.role);
    if (!name || !/^[A-Za-z0-9._-]{2,40}$/.test(username) || role !== 'ortoptista') {
      return send(reply, req, usersPage(req, html`<div class="notice err" role="alert">Dados inválidos (utilizador: letras, números, . _ -).</div>`), 400);
    }
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      return send(reply, req, usersPage(req, html`<div class="notice err" role="alert">Esse utilizador já existe.</div>`), 400);
    }
    const pw = generatePassword();
    const info = db.prepare('INSERT INTO users (username, display_name, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, 1)')
      .run(username, name, role, hashPassword(pw));
    audit(db, req.user.id, 'criar', 'utilizador', Number(info.lastInsertRowid), { role });
    return send(reply, req, usersPage(req, tempPasswordBox(name, pw)));
  });

  app.post('/admin/utilizadores/:id/reset', async (req, reply) => {
    const id = idParam(req);
    const u = id && db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u || u.id === req.user.id) return reply.callNotFound();
    const pw = generatePassword();
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hashPassword(pw), id);
    destroyUserSessions(db, id);
    audit(db, req.user.id, 'reset_password', 'utilizador', id);
    return send(reply, req, usersPage(req, tempPasswordBox(u.display_name, pw)));
  });

  app.post('/admin/utilizadores/:id/ativo', async (req, reply) => {
    const id = idParam(req);
    const u = id && db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u || u.id === req.user.id) return reply.callNotFound();
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(u.active ? 0 : 1, id);
    if (u.active) destroyUserSessions(db, id);
    audit(db, req.user.id, u.active ? 'desativar' : 'reativar', 'utilizador', id);
    return reply.redirect('/admin/utilizadores?msg=guardado');
  });

  // Os normativos passaram para a ficha de cada ato.
  app.get('/admin/normativos', async (req, reply) => reply.redirect('/admin/exames'));

  await app.register(fichaRoutes, { db });
}

