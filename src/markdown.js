// Markdown das notas das tarefas: um subconjunto seguro, sem dependências.
// Títulos (# a ######), parágrafos, quebras de linha, **negrito**, *itálico*, ~~riscado~~, `código`,
// listas (com - * + ou 1.), listas de verificação (- [ ] / - [x]), citações (>), linhas (---) e
// links [texto](https://…) ou endereços soltos. Todo o texto é escapado primeiro; não há HTML
// escrito à mão, e os links só podem ser http(s) ou mailto.
//
// Os títulos descem um nível (# → <h2>) porque a página já tem o seu <h1>.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const SAFE_URL = /^(https?:\/\/|mailto:)[^\s"'<>]+$/i;

/** Formatação dentro de uma linha (o texto já vem escapado). */
function inline(s) {
  const codes = [];
  // Código primeiro: o que está entre ` ` não é formatado.
  let out = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  // Links [texto](url): a url vem escapada; desfaz-se &amp; só para validar.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const raw = url.replace(/&amp;/g, '&');
    if (!SAFE_URL.test(raw)) return m;
    return `<a href="${esc(raw)}" rel="noopener noreferrer" target="_blank">${text}</a>`;
  });
  // Endereços soltos (fora de links já feitos).
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, (m, pre, url) => {
    const raw = url.replace(/&amp;/g, '&');
    return SAFE_URL.test(raw) ? `${pre}<a href="${esc(raw)}" rel="noopener noreferrer" target="_blank">${url}</a>` : m;
  });
  out = out
    .replace(/\*\*(?=\S)([^*]*\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([^_]*\S)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*]*\S)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=\S)([^_]*\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([^~]*\S)~~/g, '<del>$1</del>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

const LIST_RE = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;

export function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map((l) => inline(esc(l))).join('<br>')}</p>`);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { flushPara(); continue; }
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flushPara();
      const level = Math.min(6, h[1].length + 1);
      out.push(`<h${level} class="md-h${h[1].length}">${inline(esc(h[2]))}</h${level}>`);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushPara(); out.push('<hr>'); continue; }
    if (/^\s*>/.test(line)) {
      flushPara();
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      i--;
      out.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
      continue;
    }
    if (LIST_RE.test(line)) {
      flushPara();
      const block = [];
      while (i < lines.length && (LIST_RE.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && block.length))) block.push(lines[i++]);
      i--;
      out.push(renderList(block));
      continue;
    }
    para.push(line);
  }
  flushPara();
  return out.join('\n');
}

/** Listas (com sublistas pela indentação). */
function renderList(block) {
  const items = [];
  for (const l of block) {
    const m = LIST_RE.exec(l);
    if (m) items.push({ indent: m[1].replace(/\t/g, '  ').length, ordered: /\d/.test(m[2]), text: m[3] });
    else if (items.length) items[items.length - 1].text += `\n${l.trim()}`;
  }
  let html = '';
  const stack = [];
  const open = (it) => { const tag = it.ordered ? 'ol' : 'ul'; stack.push({ tag, indent: it.indent }); html += `<${tag}>`; };
  for (const it of items) {
    if (!stack.length) open(it);
    else if (it.indent > stack[stack.length - 1].indent) { html = html.replace(/<\/li>$/, ''); open(it); } else {
      while (stack.length > 1 && it.indent < stack[stack.length - 1].indent) html += `</${stack.pop().tag}></li>`;
    }
    const task = /^\[( |x|X)\]\s+(.*)$/s.exec(it.text);
    const body = (task ? task[2] : it.text).split('\n').map((t) => inline(esc(t))).join('<br>');
    html += task
      ? `<li class="md-task${task[1] !== ' ' ? ' done' : ''}"><span class="md-box" aria-hidden="true">${task[1] !== ' ' ? '✓' : ''}</span><span class="sr">${task[1] !== ' ' ? 'feito: ' : 'por fazer: '}</span>${body}</li>`
      : `<li>${body}</li>`;
  }
  while (stack.length) { html += `</${stack.pop().tag}>`; if (stack.length) html += '</li>'; }
  return html;
}
