// Auditoria de alinhamento: mede o desvio vertical dos «?» face ao texto e a altura dos botões na mesma linha.
// Uso: arrancar a app com dados de demonstração e correr  node tools/auditar-alinhamento.mjs  (THEME=<id> para outro tema).
import { chromium } from 'playwright';
const paths = ['/hoje','/agenda','/pedidos','/pedidos/novo','/estatistica','/admin','/admin/exames','/admin/reservas','/admin/utilizadores','/admin/sistema','/bloqueios','/aparencia','/conta','/admin/exames/1/ficha','/exames/1','/exames/1/agendar','/pedidos/1'];
const browser = await chromium.launch();
let total = 0;
for (const vp of [{width:1280,height:900},{width:390,height:844}]) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  await page.goto('http://localhost:3123/login');
  await page.fill('input[name=username]', 'hugo'); await page.fill('input[name=password]', 'demo-demo-demo');
  await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);
  for (const p of paths) {
    const resp = await page.goto('http://localhost:3123' + p); if (process.env.THEME) await page.evaluate(t => { document.documentElement.dataset.theme = t; }, process.env.THEME);
    if (!resp || resp.status() >= 400) continue;
    const r = await page.evaluate(() => {
      const out = [];
      const vis = el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
      // 1. "?" vs texto anterior (última linha do texto que o antecede no mesmo bloco)
      for (const h of document.querySelectorAll('.help > summary')) {
        if (!vis(h)) continue;
        const hb = h.getBoundingClientRect(); const hc = hb.top + hb.height / 2;
        let prev = h.parentElement.previousSibling; let txt = null;
        while (prev) { if (prev.nodeType === 3 && prev.textContent.trim()) { txt = prev; break; } if (prev.nodeType === 1 && prev.textContent.trim() && vis(prev)) { txt = prev; break; } prev = prev.previousSibling; }
        if (!txt) continue;
        const rg = document.createRange(); rg.selectNodeContents(txt);
        const rects = [...rg.getClientRects()].filter(x => x.width > 0);
        if (!rects.length) continue;
        const last = rects[rects.length - 1]; const lc = last.top + last.height / 2;
        // só conta se estiver na mesma linha
        if (Math.abs(hc - lc) < 14) { const d = hc - lc; if (Math.abs(d) > 1.5) out.push(`help off ${d.toFixed(1)}px  «${(txt.textContent||'').trim().slice(-24)}»`); }
        else out.push(`help em linha diferente de «${(txt.textContent||'').trim().slice(-24)}» (${(hc-lc).toFixed(0)}px)`);
      }
      // 2. controlos irmãos na mesma linha: centros e alturas
      const sel = '.btn, button, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, .copy, a.btn';
      const seen = new Set();
      const parents = new Set();
      for (const c of document.querySelectorAll(sel)) { if (vis(c)) parents.add(c.parentElement); }
      for (const par of parents) {
        // percorre também filhos de display:contents / form
        const kids = [];
        const walk = (n) => { for (const k of n.children) { const cs = getComputedStyle(k); if (cs.display === 'contents' || (k.tagName === 'FORM' && cs.display === 'inline')) walk(k); else kids.push(k); } };
        walk(par);
        const ctrls = kids.filter(k => k.matches(sel) && vis(k) && !k.closest('.help-body'));
        // agrupar por linha (sobreposição vertical)
        const rows = [];
        for (const c of ctrls) { const b = c.getBoundingClientRect(); const row = rows.find(r => b.top < r.bottom - 2 && b.bottom > r.top + 2); if (row) { row.items.push([c,b]); row.bottom = Math.max(row.bottom, b.bottom); row.top = Math.min(row.top, b.top);} else rows.push({top:b.top,bottom:b.bottom,items:[[c,b]]}); }
        for (const row of rows) {
          if (row.items.length < 2) continue;
          const cs = row.items.map(([c,b]) => b.top + b.height/2);
          const hs = row.items.map(([c,b]) => b.height);
          const dc = Math.max(...cs) - Math.min(...cs); const dh = Math.max(...hs) - Math.min(...hs);
          if (dc > 1.5 || dh > 2) out.push(`controlos desiguais (centro Δ${dc.toFixed(1)}, altura Δ${dh.toFixed(1)}): ` + row.items.map(([c,b]) => `${c.tagName.toLowerCase()}.${(c.className||'').toString().split(' ')[0]}[${Math.round(b.height)}]`).join(' '));
        }
      }
      return [...new Set(out)];
    });
    for (const l of r) { console.log(`${vp.width} ${p}  ${l}`); total++; }
  }
  await ctx.close();
}
console.log('TOTAL', total);
await browser.close();
