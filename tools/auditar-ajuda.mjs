// Auditoria das caixas de ajuda «?»: abre cada uma (rato e toque) e confirma que fica dentro do ecrã.
// Uso: arrancar a app com dados de demonstração na porta 3123 e correr  node tools/auditar-ajuda.mjs
import { chromium } from 'playwright';
const S = '/tmp/claude-0/-home-claude/1a76be65-e1c4-5674-bced-9bcc869c56b9/scratchpad';
const paths = ['/tarefas', '/tarefas/2', '/fluxo', '/hoje', '/agenda', '/pedidos/novo', '/investigacao/nova', '/admin', '/admin/exames', '/admin/reservas', '/admin/sistema', '/bloqueios', '/aparencia', '/conta', '/estatistica', '/admin/exames/1/ficha', '/exames/1/agendar'];
const b = await chromium.launch();
let bad = 0, total = 0;
for (const [w, mobile] of [[1280, false], [1920, false], [390, true]]) {
  const c = await b.newContext({ viewport: { width: w, height: 900 }, hasTouch: mobile });
  const p = await c.newPage();
  await p.goto('http://localhost:3123/login'); await p.fill('input[name=username]', 'hugo'); await p.fill('input[name=password]', 'demo-demo-demo');
  await Promise.all([p.waitForNavigation(), p.click('button[type=submit]')]);
  for (const path of paths) {
    await p.goto('http://localhost:3123' + path);
    const n = await p.locator('details.help > summary').count();
    for (let i = 0; i < n; i++) {
      const s = p.locator('details.help > summary').nth(i);
      if (!(await s.isVisible())) continue;
      await s.scrollIntoViewIfNeeded();
      if (mobile) await s.tap(); else await s.hover();
      await p.waitForTimeout(60);
      const r = await p.evaluate((i) => {
        const d = document.querySelectorAll('details.help')[i];
        const bb = d.querySelector('.help-body').getBoundingClientRect();
        return { l: Math.round(bb.left), r: Math.round(bb.right), vw: document.documentElement.clientWidth, shown: bb.width > 0 };
      }, i);
      total++;
      if (!r.shown || r.l < 0 || r.r > r.vw) { bad++; console.log(w, path, i, r); }
      if (mobile) await s.tap(); else await p.mouse.move(5, 890);
    }
  }
  await c.close();
}
console.log('caixas verificadas', total, 'cortadas', bad);
await b.close();
