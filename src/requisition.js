// Impresso de requisição em PDF editável (campos AcroForm), gerado a pedido a partir dos
// atos/MCDTs e das definições (Administração → Requisição). Página 1: para o médico (colar a
// etiqueta do doente e a vinheta, assinalar exames, suspeita); página 2: informação para o doente
// (Markdown editável + durações tiradas dos atos). Usa só as fontes base do PDF (Helvetica).
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { getSetting } from './db.js';
import { fmtDuration } from './domain/tape.js';

const MM = 72 / 25.4;
const A4 = [595.28, 841.89];
const M = 15 * MM;
const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const INK = hex('#1d1d1f');
const INK2 = hex('#55555a');
const RULE = hex('#9a9aa0');
const SOFT = hex('#e2e0e4');
const FILL = hex('#f3f1f4');
const WHITE = rgb(1, 1, 1);

export const REQ_GROUPS = [
  { key: 'eletro', label: 'Eletrofisiologia' },
  { key: 'imagem', label: 'Imagem' },
  { key: 'funcao', label: 'Função visual e ortóptica' },
];

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Atos que aparecem no impresso, por grupo (só clínicos e ativos). */
export function requisitionActs(db) {
  return db.prepare("SELECT * FROM exam_types WHERE active = 1 AND kind = 'clinico' AND req_group <> '' ORDER BY sort, name").all();
}

/** Escurece uma cor até ter contraste ≥ 4.5 com o branco (texto pequeno impresso). */
export function readableAccent(h) {
  let c = /^#[0-9a-f]{6}$/i.test(h || '') ? h : '#3a3a3c';
  const lum = (x) => {
    const v = [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16) / 255).map((u) => (u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  for (let i = 0; i < 40 && 1.05 / (lum(c) + 0.05) < 4.5; i++) {
    c = `#${[1, 3, 5].map((k) => Math.round(parseInt(c.slice(k, k + 2), 16) * 0.92).toString(16).padStart(2, '0')).join('')}`;
  }
  return c;
}

export async function buildRequisitionPdf(db) {
  const ACC = hex(readableAccent(getSetting(db, 'req_accent')));
  const doc = await PDFDocument.create();
  doc.setTitle('Requisição de exames — Ortóptica e Função Visual');
  doc.setAuthor('CIBIT-ICNAS · Universidade de Coimbra');
  doc.setSubject('Requisição de exames de ortóptica, eletrofisiologia visual e imagem');
  doc.setLanguage('pt-PT');
  const F = await doc.embedFont(StandardFonts.Helvetica);
  const FB = await doc.embedFont(StandardFonts.HelveticaBold);
  const FI = await doc.embedFont(StandardFonts.HelveticaOblique);
  const form = doc.getForm();

  // Só caracteres que a Helvetica do PDF sabe escrever (WinAnsi); o resto vira «?».
  const okChar = new Map();
  const safe = (s) => [...String(s ?? '')].map((ch) => {
    if (!okChar.has(ch)) { try { F.encodeText(ch); okChar.set(ch, true); } catch { okChar.set(ch, false); } }
    return okChar.get(ch) ? ch : '?';
  }).join('');

  const header = (getSetting(db, 'report_header') || []).map(safe);
  const email = safe(getSetting(db, 'req_email') || '');
  const clinicalLabel = safe(getSetting(db, 'req_clinical_label') || '');
  const info = String(getSetting(db, 'req_patient_info') || '');
  const updated = getSetting(db, 'req_updated_at');
  const version = updated ? `${Number(updated.slice(8, 10))} de ${MONTHS[Number(updated.slice(5, 7)) - 1]} de ${updated.slice(0, 4)}` : '';
  const acts = requisitionActs(db);

  let logo = null;
  const dataUrl = getSetting(db, 'report_logo') || '';
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl);
  if (m) {
    try { logo = m[1] === 'png' ? await doc.embedPng(Buffer.from(m[2], 'base64')) : await doc.embedJpg(Buffer.from(m[2], 'base64')); } catch { logo = null; }
  }

  const W = A4[0];
  const H = A4[1];
  const cw = W - 2 * M;
  let page;
  const text = (x, y, s, size = 8.5, font = F, color = INK) => page.drawText(safe(s), { x, y, size, font, color });
  const width = (s, size, font = F) => font.widthOfTextAtSize(safe(s), size);
  const line = (x1, y1, x2, y2, color = RULE, thickness = 0.5) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color, thickness });

  const tf = (name, x, y, w, h, { multiline = false, size = 9, border = true } = {}) => {
    const f = form.createTextField(name);
    if (multiline) f.enableMultiline();
    f.addToPage(page, { x, y, width: w, height: h, font: F, textColor: INK, ...(border ? { borderColor: RULE, borderWidth: 0.6, backgroundColor: WHITE } : { borderWidth: 0 }) });
    f.setFontSize(size);
    return f;
  };
  const cb = (name, x, y, label = '', size = 9.5, lsize = 8.6) => {
    const f = form.createCheckBox(name);
    f.addToPage(page, { x, y, width: size, height: size, borderColor: RULE, borderWidth: 0.7, backgroundColor: WHITE, textColor: ACC });
    if (label) text(x + size + 3.5, y + 1.8, label, lsize);
  };
  const labeled = (label, name, x, y, w, h = 15, opts = {}) => {
    text(x, y + h + 2.5, label, 7.3, F, INK2);
    tf(name, x, y, w, h, opts);
  };
  const section = (y, title) => {
    page.drawRectangle({ x: M, y: y - 1, width: 3, height: 11, color: ACC });
    text(M + 7, y + 1, title, 9.5, FB);
    line(M, y - 4, W - M, y - 4);
    return y - 9;
  };
  const drawHeader = (subtitle) => {
    let y = H - M;
    let x = M;
    let shift = 0;
    if (logo) {
      const sc = Math.min((14 * MM) / logo.height, (40 * MM) / logo.width);
      const lh = logo.height * sc;
      page.drawImage(logo, { x: M, y: y - lh, width: logo.width * sc, height: lh });
      x = M + logo.width * sc + 10;
      // O título começa abaixo do logótipo.
      shift = Math.max(0, lh + 22 - 40);
    }
    header.forEach((l, i) => text(x, y - 8 - i * 10, l, 7.5, i === 0 ? FB : F, INK2));
    text(M, y - 40 - shift, 'Requisição de exames', 17, FB);
    text(M, y - 53 - shift, subtitle, 9, F, INK2);
    y -= 60 + shift;
    line(M, y, W - M, y, INK, 1.2);
    return y;
  };
  const footer = (n, total) => {
    line(M, M + 10, W - M, M + 10, RULE, 0.4);
    text(M, M, 'Contém dados de saúde: envie apenas para o e-mail de marcações do ICNAS indicado no topo.', 6.8, F, INK2);
    const right = `${version ? `Versão de ${version} · ` : ''}página ${n} de ${total}`;
    text(W - M - width(right, 6.8), M, right, 6.8, F, INK2);
  };
  const pasteBox = (name, x, y, w, h, title, hint) => {
    text(x, y + h + 4, title, 8.3, FB);
    text(x + width(title, 8.3, FB) + 6, y + h + 4, hint, 7.3, F, INK2);
    page.drawRectangle({ x, y, width: w, height: h, borderColor: RULE, borderWidth: 0.8, borderDashArray: [3, 2] });
    tf(name, x + 2, y + 2, w - 4, h - 4, { multiline: true, border: false });
  };

  // ---------- Página 1 ----------
  page = doc.addPage(A4);
  let y = drawHeader('Ortóptica, eletrofisiologia visual e imagem');
  page.drawRectangle({ x: M, y: y - 30, width: cw, height: 22, color: FILL });
  text(M + 8, y - 22, 'Envie para:', 8.3, FB);
  if (email) text(M + 58, y - 22, email, 9.5, FB, ACC);
  else tf('envio_email', M + 58, y - 25, 210, 13, { size: 8.5 });
  const note = 'Preencha no computador ou imprima e preencha à mão.';
  text(W - M - 8 - width(note, 7.3), y - 22, note, 7.3, F, INK2);
  y -= 46;

  y = section(y, '1. Doente');
  const bh = 34 * MM;
  const bw = cw * 0.56;
  y -= bh + 16;
  pasteBox('doente', M, y, bw, bh, 'Etiqueta do doente', 'cole aqui, ou escreva nome, nascimento e n.º de utente');
  const xr = M + bw + 14;
  const wr = cw - bw - 14;
  labeled('Telefone do doente (para marcar)', 'doente_telefone', xr, y + bh - 15, wr);
  text(xr, y + bh - 34, 'Entidade responsável', 7.3, F, INK2);
  [['sns', 'SNS'], ['adse', 'ADSE'], ['seguro', 'Seguro / subsistema'], ['particular', 'Particular']].forEach(([k, l], i) => {
    cb(`entidade_${k}`, xr + (i % 2) * (wr / 2), y + bh - 50 - Math.floor(i / 2) * 15, l, 9.5, 8.5);
  });
  text(xr, y + 17.5, 'Qual (seguro / subsistema)', 6.8, F, INK2);
  tf('entidade_qual', xr, y + 2, wr, 13, { size: 8.5 });
  y -= 30;

  y = section(y, '2. Exames pedidos');
  const colx = [M, M + cw * 0.31, M + cw * 0.58];
  const top = y - 14;
  let rows = 0;
  REQ_GROUPS.forEach((g, gi) => {
    const items = acts.filter((a) => a.req_group === g.key);
    if (!items.length) return;
    let yy = top;
    text(colx[gi], yy, g.label, 7.8, FB, ACC);
    for (const a of items) {
      yy -= 15.5;
      // Nomes compridos não podem invadir a coluna seguinte.
      let name = safe(a.name);
      const maxw = (gi < 2 ? colx[gi + 1] - colx[gi] : cw - (colx[gi] - M)) - 20;
      while (width(name, 8.6) > maxw && name.length > 4) name = `${name.slice(0, -2)}…`;
      cb(`exame_${a.code}`, colx[gi], yy - 1, name);
    }
    rows = Math.max(rows, items.length);
  });
  y = top - rows * 15.5 - 22;
  cb('exame_outro', M, y - 1, 'Outro:');
  tf('exame_outro_qual', M + 46, y - 3.5, cw * 0.5, 13, { size: 8.5 });
  text(M + cw * 0.5 + 62, y + 1, 'Só um olho?', 8, F, INK2);
  cb('olho_od', M + cw * 0.5 + 112, y - 1, 'OD', 9.5, 8.5);
  cb('olho_oe', M + cw * 0.5 + 152, y - 1, 'OE', 9.5, 8.5);
  y -= 32;

  y = section(y, '3. Informação clínica');
  const clinH = Math.max(50, Math.min(82, y - M - 220));
  y -= clinH + 10;
  labeled(clinicalLabel, 'clinica', M, y, cw, clinH, { multiline: true });
  y -= 20;
  text(M, y + 1.5, 'Prioridade:', 8.3, FB);
  cb('prioridade_normal', M + 56, y - 1, 'Normal', 9.5, 8.5);
  cb('prioridade_urgente', M + 118, y - 1, 'Prioritário — motivo:', 9.5, 8.5);
  tf('prioridade_motivo', M + 222, y - 3.5, cw - 222, 13, { size: 8.5 });
  y -= 34;

  y = section(y, '4. Médico requisitante');
  const vh = 34 * MM;
  y -= vh + 16;
  pasteBox('medico', M, y, bw, vh, 'Vinheta ou carimbo', 'ou nome, n.º da Ordem, especialidade, instituição');
  labeled('E-mail para enviar o relatório', 'req_email', xr, y + vh - 15, wr);
  labeled('Data', 'req_data', xr, y + vh - 47, 80);
  text(xr, y + 30, 'Assinatura (manuscrita ou digital)', 7.3, F, INK2);
  line(xr, y + 2, xr + wr, y + 2, RULE, 0.6);
  const pages = [page];

  // ---------- Página 2 (e seguintes, se o texto for longo) ----------
  page = doc.addPage(A4);
  pages.push(page);
  y = drawHeader('Informação para o doente — leia antes do exame') - 18;
  const newPageIfNeeded = (need) => {
    if (y - need > M + 24) return;
    page = doc.addPage(A4);
    pages.push(page);
    y = drawHeader('Informação para o doente (continuação)') - 18;
  };

  // Texto com **negrito** e *itálico*, partido em linhas pela largura disponível.
  const words = (s) => {
    const out = [];
    const re = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
    let last = 0;
    const push = (t, font) => t.split(/(\s+)/).filter(Boolean).forEach((w) => out.push({ w: safe(w), font }));
    for (const mm of s.matchAll(re)) {
      push(s.slice(last, mm.index), F);
      const tok = mm[0];
      if (tok.startsWith('**')) push(tok.slice(2, -2), FB);
      else if (tok.startsWith('[')) push(tok.replace(/^\[([^\]]+)\]\(([^)]+)\)$/, '$1 ($2)'), F);
      else push(tok.slice(1, -1), FI);
      last = mm.index + tok.length;
    }
    push(s.slice(last), F);
    return out;
  };
  const para = (s, { x = M, size = 9.3, lead = 12.4, maxw = cw, color = INK } = {}) => {
    const ws = words(s);
    let lineWords = [];
    let lw = 0;
    const flush = () => {
      newPageIfNeeded(lead);
      let cx = x;
      for (const t of lineWords) { page.drawText(t.w, { x: cx, y, size, font: t.font, color }); cx += t.font.widthOfTextAtSize(t.w, size); }
      y -= lead;
      lineWords = [];
      lw = 0;
    };
    for (const t of ws) {
      const tw = t.font.widthOfTextAtSize(t.w, size);
      if (/^\s+$/.test(t.w)) { if (lineWords.length) { lineWords.push(t); lw += tw; } continue; }
      if (lw + tw > maxw && lineWords.length) { while (lineWords.length && /^\s+$/.test(lineWords.at(-1).w)) lineWords.pop(); flush(); }
      lineWords.push(t);
      lw += tw;
    }
    if (lineWords.length) flush();
  };
  for (const block of info.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    for (const raw of block.split('\n')) {
      const ln = raw.trimEnd();
      if (!ln.trim()) continue;
      const h = /^(#{1,6})\s+(.*)$/.exec(ln);
      const li = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(ln);
      if (h) {
        newPageIfNeeded(30);
        y -= 2;
        text(M, y, h[2].replace(/\*\*/g, ''), h[1].length <= 1 ? 11 : 9.6, FB, ACC);
        y -= 13;
      } else if (li) {
        newPageIfNeeded(13);
        text(M + 4, y, '•', 9.3, F, INK);
        para(li[1], { x: M + 14, maxw: cw - 14 });
      } else para(ln);
    }
    y -= 7;
  }

  // Durações (a partir dos atos)
  if (acts.length) {
    const rowsN = Math.ceil(acts.length / 2);
    newPageIfNeeded(30 + rowsN * 15);
    y -= 4;
    page.drawRectangle({ x: M, y: y - 1, width: 3, height: 11, color: ACC });
    text(M + 7, y + 1, 'Duração aproximada de cada exame (inclui preparação)', 9.5, FB);
    line(M, y - 4, W - M, y - 4);
    y -= 18;
    const colw = cw / 2;
    // Linhas com nota de preparação são mais altas: posição de cada linha acumulada.
    const rowH = Array.from({ length: rowsN }, (_, r) => (acts[2 * r]?.req_prep || acts[2 * r + 1]?.req_prep ? 24 : 15));
    const rowY = rowH.map((_, r) => y - rowH.slice(0, r).reduce((a, b) => a + b, 0));
    acts.forEach((a, k) => {
      const xx = M + (k % 2) * colw;
      const yy = rowY[Math.floor(k / 2)];
      const d = fmtDuration(a.minutes);
      text(xx, yy, a.name, 9);
      text(xx + colw - 14 - width(d, 9, FB), yy, d, 9, FB);
      if (a.req_prep) text(xx, yy - 10, a.req_prep, 7.4, FI, INK2);
    });
    y -= rowH.reduce((a, b) => a + b, 0) + 6;
    text(M, y, 'Se tiver vários exames no mesmo dia, o tempo soma-se. Pode ter de esperar entre exames.', 8.3, F, INK2);
  }

  pages.forEach((p, i) => { page = p; footer(i + 1, pages.length); });
  form.updateFieldAppearances(F);
  return doc.save();
}
