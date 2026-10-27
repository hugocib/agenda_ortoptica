import test from 'node:test';
import assert from 'node:assert/strict';
import { contrast, contrastPairs, THEMES, themesCss } from '../src/themes.js';

test('há 12 temas com ids únicos', () => {
  assert.equal(THEMES.length, 12);
  assert.equal(new Set(THEMES.map((t) => t.id)).size, 12);
});

test('todos os temas cumprem o contraste AA, em claro e em escuro', () => {
  const bad = [];
  for (const t of THEMES) {
    for (const [mode, vars] of [['claro', t.lightVars], ['escuro', t.darkVars]]) {
      for (const [name, fg, bg, min] of contrastPairs(vars)) {
        if (contrast(fg, bg) < min) bad.push(`${t.id}/${mode}/${name}: ${contrast(fg, bg).toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('CSS dos temas declara cada tema e o modo escuro', () => {
  const css = themesCss();
  for (const t of THEMES) {
    assert.ok(css.includes(`[data-theme="${t.id}"]{`));
    assert.ok(css.includes(`[data-theme="${t.id}"][data-mode="escuro"]`));
  }
});
