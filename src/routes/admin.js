import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { html, euros } from '../html.js';
import { audit, getSetting, setSetting } from '../db.js';
import { destroyUserSessions, generatePassword, hashPassword } from '../auth.js';
import { isBackupName, listBackups, runBackup } from '../backup.js';
import { fmtNum, getTemplate, numericFields, parseNumber, TEMPLATE_KEYS, TEMPLATES } from '../domain/reports.js';
import { isTime, toMin } from '../time.js';
import { flash, icon, pageHead } from '../ui.js';
import { arr, forbid, idParam, isOrtho, send, str } from './util.js';

const WEEKDAYS = [[1, 'Segunda'], [2, 'Terça'], [3, 'Quarta'], [4, 'Quinta'], [5, 'Sexta'], [6, 'Sábado']];

function tabs(active) {
  const t = (href, label, key) => html`<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
  return html`<nav class="tabs">${t('/admin', 'Geral', 'geral')}${t('/admin/exames', 'Tipos de exame', 'exames')}${t('/admin/utilizadores', 'Utilizadores', 'users')}${t('/admin/normativos', 'Normativos', 'norms')}</nav>`;
}

const ExamTypeSchema = z.object({
  name: z.string().trim().min(2).max(120),
  sap_code: z.string().trim().max(30),
  minutes: z.coerce.number().int().min(5).max(480),
  price: z.string().trim(),
  is_electro: z.enum(['0', '1']),
  report_template: z.enum(TEMPLATE_KEYS),
  active: z.enum(['0', '1']),
  sort: z.coerce.number().int().min(0).max(999),
});

function parsePrice(s) {
  const p = parseNumber(s);
  if (p.empty) return 0;
  if (p.error || p.value < 0 || p.value > 100000) return null;
  return Math.round(p.value * 100);
}

export default async function adminRoutes(app, { db, config }) {
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/admin') && !isOrtho(req)) return forbid(reply);
  });

  // ---------- Geral ----------
  app.get('/admin', async (req, reply) => {
    const availability = getSetting(db, 'availability');
    const rows = [...availability, ...Array(Math.max(0, 6 - availability.length)).fill({ weekday: '', start: '', end: '' })];
    const header = getSetting(db, 'report_header');
    const icsToken = getSetting(db, 'ics_token');
    const host = req.headers.host;
    const backups = listBackups(config.backupDir).slice(0, 15);
    return send(reply, req, {
      title: 'Administração',
      active: 'admin',
      body: html`${pageHead('Administração')}${tabs('geral')}${flash(req.query, req)}
        <section class="sec"><div class="sec-h"><h2>Horário de exames externos</h2></div>
          <form method="post" action="/admin/horario" class="stack">
            <table class="table compact-table"><thead><tr><th>Dia</th><th>Início</th><th>Fim</th></tr></thead><tbody>
            ${rows.map((w) => html`<tr>
              <td><select name="weekday"><option value="">—</option>${WEEKDAYS.map(([n, l]) => html`<option value="${n}"${w.weekday === n ? html` selected` : ''}>${l}</option>`)}</select></td>
              <td><input type="time" name="start" step="900" value="${w.start}"></td>
              <td><input type="time" name="end" step="900" value="${w.end}"></td></tr>`)}
            </tbody></table>
            <div class="grid3">
              <label>Grelha (min)<select name="slot_step_min">${[5, 10, 15, 20, 30].map((n) => html`<option${getSetting(db, 'slot_step_min') === n ? html` selected` : ''}>${n}</option>`)}</select></label>
              <label>Máx. eletrofisiologia por dia<input type="number" name="max_electro_per_day" min="0" max="10" value="${getSetting(db, 'max_electro_per_day')}"></label>
              <label>Mostrar vagas para (semanas)<input type="number" name="horizon_weeks" min="1" max="26" value="${getSetting(db, 'horizon_weeks')}"></label>
            </div>
            <p class="muted small">Mudar o horário não altera exames já marcados.</p>
            <div><button class="btn primary" type="submit">Guardar horário</button></div>
          </form>
        </section>
        <section class="sec"><div class="sec-h"><h2>Cabeçalho e assinatura dos relatórios</h2></div>
          <form method="post" action="/admin/relatorio" class="stack">
            <label>Cabeçalho (uma linha por linha)<textarea name="report_header" rows="3" maxlength="600">${header.join('\n')}</textarea></label>
            <div class="grid3">
              <label>Função de quem assina<input name="report_signer" maxlength="80" value="${getSetting(db, 'report_signer')}"></label>
              <label>Identificação profissional<input name="report_signer_id" maxlength="120" value="${getSetting(db, 'report_signer_id')}"></label>
              <label class="check"><input type="checkbox" name="report_medical_line" value="1"${getSetting(db, 'report_medical_line') ? html` checked` : ''}> <span>Linha de assinatura médica</span></label>
            </div>
            <div><button class="btn primary" type="submit">Guardar</button></div>
          </form>
        </section>
        <section class="sec"><div class="sec-h"><h2>Calendário (ICS)</h2></div>
          <p>Subscreva este endereço no Outlook ou no telemóvel para ver os exames marcados. Só mostra o tipo de exame e a hora, sem dados de doentes.</p>
          <p><button type="button" class="copy" data-copy="https://${host}/ics/${icsToken}/agenda.ics" aria-label="Copiar endereço do calendário">https://${host}/ics/${icsToken}/agenda.ics${icon('copiar', 'ico xs')}</button></p>
          <form method="post" action="/admin/ics" class="inline"><button class="btn" data-confirm="Criar novo endereço? O atual deixa de funcionar.">Gerar novo endereço</button></form>
        </section>
        <section class="sec"><div class="sec-h"><h2>Cópias de segurança</h2></div>
          <p class="muted">Automáticas a cada ${config.backupEveryHours} h; guardam-se as últimas ${config.backupKeep}. Pasta no servidor: <code>${config.backupDir}</code>.</p>
          <form method="post" action="/admin/backups" class="inline"><button class="btn">Fazer cópia agora</button></form>
          ${backups.length ? html`<table class="table"><thead><tr><th>Ficheiro</th><th>Tamanho</th><th></th></tr></thead><tbody>
            ${backups.map((b) => html`<tr><td><code>${b.name}</code></td><td>${(b.size / 1024).toFixed(0)} KB</td><td class="right"><a href="/admin/backups/${b.name}">Descarregar</a></td></tr>`)}
          </tbody></table>` : html`<p class="notice warn">Ainda não há cópias de segurança.</p>`}
        </section>`,
    });
  });

  app.post('/admin/horario', async (req, reply) => {
    const b = req.body || {};
    const wd = arr(b.weekday);
    const st = arr(b.start);
    const en = arr(b.end);
    const windows = [];
    for (let i = 0; i < wd.length; i++) {
      if (!wd[i]) continue;
      const weekday = Number(wd[i]);
      if (!(weekday >= 1 && weekday <= 6) || !isTime(st[i]) || !isTime(en[i]) || toMin(en[i]) <= toMin(st[i])) {
        return reply.redirect('/admin?err=dados_invalidos');
      }
      windows.push({ weekday, start: st[i], end: en[i] });
    }
    windows.sort((a, c) => a.weekday - c.weekday || a.start.localeCompare(c.start));
    const step = Number(str(b.slot_step_min));
    const maxE = Number(str(b.max_electro_per_day));
    const horizon = Number(str(b.horizon_weeks));
    if (![5, 10, 15, 20, 30].includes(step) || !(maxE >= 0 && maxE <= 10) || !(horizon >= 1 && horizon <= 26)) return reply.redirect('/admin?err=dados_invalidos');
    db.transaction(() => {
      setSetting(db, 'availability', windows);
      setSetting(db, 'slot_step_min', step);
      setSetting(db, 'max_electro_per_day', Math.trunc(maxE));
      setSetting(db, 'horizon_weeks', Math.trunc(horizon));
      audit(db, req.user.id, 'alterar_horario', 'definicoes', null, { windows, step, maxE, horizon });
    })();
    return reply.redirect('/admin?msg=guardado');
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
    return reply.redirect('/admin?msg=guardado');
  });

  app.post('/admin/ics', async (req, reply) => {
    setSetting(db, 'ics_token', crypto.randomBytes(24).toString('base64url'));
    audit(db, req.user.id, 'regenerar_ics', 'definicoes');
    return reply.redirect('/admin?msg=ics');
  });

  app.post('/admin/backups', async (req, reply) => {
    try {
      const name = await runBackup(db, config.backupDir, config.backupKeep);
      audit(db, req.user.id, 'backup', 'definicoes', null, { name });
      return reply.redirect('/admin?msg=backup');
    } catch (err) {
      req.log.error({ err }, 'backup manual falhou');
      return reply.redirect('/admin?err=backup');
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

  // ---------- Tipos de exame ----------
  app.get('/admin/exames', async (req, reply) => {
    const types = db.prepare('SELECT * FROM exam_types ORDER BY sort, name').all();
    const row = (t) => html`<form method="post" action="${t ? `/admin/exames/${t.id}` : '/admin/exames'}" class="type-row${t && !t.active ? ' inactive' : ''}">
      <input name="name" value="${t?.name || ''}" required maxlength="120" aria-label="Nome" placeholder="Nome do exame">
      <input name="sap_code" value="${t?.sap_code || ''}" maxlength="30" aria-label="Código SAP" placeholder="SAP">
      <input name="minutes" type="number" min="5" max="480" value="${t?.minutes ?? 30}" aria-label="Minutos" class="num">
      <input name="price" inputmode="decimal" value="${t ? fmtNum(t.price_cents / 100) : ''}" aria-label="Preço (€)" class="num" placeholder="€">
      <select name="is_electro" aria-label="Eletrofisiologia"><option value="0">—</option><option value="1"${t?.is_electro ? html` selected` : ''}>Eletro</option></select>
      <select name="report_template" aria-label="Modelo de relatório">${TEMPLATE_KEYS.map((k) => html`<option value="${k}"${(t?.report_template || 'generico') === k ? html` selected` : ''}>${TEMPLATES[k].title}</option>`)}</select>
      <select name="active" aria-label="Ativo"><option value="1">Ativo</option><option value="0"${t && !t.active ? html` selected` : ''}>Inativo</option></select>
      <input name="sort" type="number" min="0" max="999" value="${t?.sort ?? types.length}" aria-label="Ordem" class="num small-num">
      <button class="btn ${t ? '' : 'primary'}" type="submit">${t ? 'Guardar' : 'Adicionar'}</button>
    </form>`;
    return send(reply, req, {
      title: 'Tipos de exame',
      active: 'admin',
      body: html`${pageHead('Administração')}${tabs('exames')}${flash(req.query, req)}
        <section class="sec">
          <p class="muted">Duração inclui preparação. Mudar o preço não altera exames já pedidos (o preço fica registado no pedido). Para deixar de usar um exame, ponha «Inativo» em vez de o apagar.</p>
          <div class="type-head"><span>Nome</span><span>SAP</span><span>Min</span><span>€</span><span>Tipo</span><span>Relatório</span><span>Estado</span><span>Ordem</span><span></span></div>
          ${types.map(row)}
          <h3 class="day-label">Novo tipo de exame</h3>
          ${row(null)}
        </section>`,
    });
  });

  const saveType = (req, reply, id) => {
    const b = req.body || {};
    const parsed = ExamTypeSchema.safeParse(Object.fromEntries(['name', 'sap_code', 'minutes', 'price', 'is_electro', 'report_template', 'active', 'sort'].map((k) => [k, str(b[k])])));
    const price = parsed.success ? parsePrice(parsed.data.price) : null;
    if (!parsed.success || price === null) return reply.redirect('/admin/exames?err=dados_invalidos');
    const v = { ...parsed.data, price_cents: price, is_electro: Number(parsed.data.is_electro), active: Number(parsed.data.active) };
    if (id) {
      db.prepare(`UPDATE exam_types SET name=@name, sap_code=@sap_code, minutes=@minutes, price_cents=@price_cents, is_electro=@is_electro,
        report_template=@report_template, active=@active, sort=@sort WHERE id=@id`).run({ ...v, id });
      audit(db, req.user.id, 'alterar', 'tipo_exame', id, { price_cents: v.price_cents, minutes: v.minutes, active: v.active });
    } else {
      const code = `t${crypto.randomBytes(4).toString('hex')}`;
      const info = db.prepare(`INSERT INTO exam_types (code, name, sap_code, minutes, price_cents, is_electro, report_template, active, sort)
        VALUES (@code, @name, @sap_code, @minutes, @price_cents, @is_electro, @report_template, @active, @sort)`).run({ ...v, code });
      audit(db, req.user.id, 'criar', 'tipo_exame', Number(info.lastInsertRowid));
    }
    return reply.redirect('/admin/exames?msg=guardado');
  };
  app.post('/admin/exames', async (req, reply) => saveType(req, reply, null));
  app.post('/admin/exames/:id', async (req, reply) => {
    const id = idParam(req);
    if (!id || !db.prepare('SELECT 1 FROM exam_types WHERE id = ?').get(id)) return reply.callNotFound();
    return saveType(req, reply, id);
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
            <label>Perfil<select name="role"><option value="secretariado">Secretariado</option><option value="ortoptista">Ortoptista</option></select></label>
            <button class="btn primary" type="submit">Criar</button>
          </form>
          <p class="muted small">É gerada uma palavra-passe temporária, mostrada uma única vez. No primeiro acesso a pessoa define a sua.</p>
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
    if (!name || !/^[A-Za-z0-9._-]{2,40}$/.test(username) || !['secretariado', 'ortoptista'].includes(role)) {
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

  // ---------- Normativos ----------
  app.get('/admin/normativos', async (req, reply) => {
    const key = TEMPLATE_KEYS.includes(str(req.query.modelo)) ? str(req.query.modelo) : 'erg';
    const tpl = getTemplate(key);
    const norms = getSetting(db, 'norms');
    const fields = numericFields(tpl);
    return send(reply, req, {
      title: 'Normativos',
      active: 'admin',
      body: html`${pageHead('Administração')}${tabs('norms')}${flash(req.query, req)}
        <section class="sec">
          <p>Limites normativos <strong>do laboratório</strong> (segundo a ISCEV, cada laboratório deve estabelecer os seus, por equipamento e protocolo). Deixe vazio o que não tiver validado: esse valor aparece no relatório sem classificação.</p>
          <form method="get" action="/admin/normativos" class="toolbar"><label>Modelo <select name="modelo">${TEMPLATE_KEYS.filter((k) => numericFields(getTemplate(k)).length).map((k) => html`<option value="${k}"${k === key ? html` selected` : ''}>${TEMPLATES[k].title}</option>`)}</select></label><button class="btn" type="submit">Abrir</button></form>
          ${fields.length ? html`<form method="post" action="/admin/normativos" class="stack">
            <input type="hidden" name="modelo" value="${key}">
            <table class="table compact-table"><thead><tr><th>Secção</th><th>Parâmetro</th><th>Mínimo</th><th>Máximo</th><th>Unidade</th></tr></thead><tbody>
            ${fields.map((f) => { const n = norms[`${key}.${f.key}`] || {}; return html`<tr><td class="muted">${f.section}</td><td>${f.label}</td>
              <td><input name="min.${f.key}" inputmode="decimal" class="num" value="${n.min != null ? fmtNum(n.min) : ''}"></td>
              <td><input name="max.${f.key}" inputmode="decimal" class="num" value="${n.max != null ? fmtNum(n.max) : ''}"></td><td>${f.unit}</td></tr>`; })}
            </tbody></table>
            <div><button class="btn primary" type="submit">Guardar normativos</button></div>
          </form>` : html`<p class="empty-state">Este modelo não tem campos numéricos.</p>`}
          <p class="muted small">Os normativos aplicam-se aos relatórios ainda não validados. Relatórios validados não mudam.</p>
        </section>`,
    });
  });

  app.post('/admin/normativos', async (req, reply) => {
    const b = req.body || {};
    const key = str(b.modelo);
    if (!TEMPLATE_KEYS.includes(key)) return reply.redirect('/admin/normativos');
    const norms = { ...getSetting(db, 'norms') };
    for (const f of numericFields(getTemplate(key))) {
      const mn = parseNumber(str(b[`min.${f.key}`]));
      const mx = parseNumber(str(b[`max.${f.key}`]));
      if (mn.error || mx.error) return reply.redirect(`/admin/normativos?modelo=${key}&err=dados_invalidos`);
      const entry = { min: mn.empty ? null : mn.value, max: mx.empty ? null : mx.value };
      if (entry.min != null && entry.max != null && entry.min > entry.max) return reply.redirect(`/admin/normativos?modelo=${key}&err=dados_invalidos`);
      if (entry.min == null && entry.max == null) delete norms[`${key}.${f.key}`];
      else norms[`${key}.${f.key}`] = entry;
    }
    setSetting(db, 'norms', norms);
    audit(db, req.user.id, 'alterar_normativos', 'definicoes', null, { modelo: key });
    return reply.redirect(`/admin/normativos?modelo=${key}&msg=guardado`);
  });
}

