// Temas visuais. Cada tema define poucas cores de base, a forma e os tipos de letra; o resto é
// derivado aqui e verificado contra o contraste mínimo WCAG 2.2 AA. Se uma cor derivada não chega
// ao mínimo, é escurecida/clareada até chegar — nunca se publica um tema ilegível.

// ---------- Cor ----------
const hex2rgb = (h) => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
};
const rgb2hex = (c) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const delin = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

function toOklab(h) {
  const [r, g, b] = hex2rgb(h).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return rgb2hex([
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(delin));
}
/** Mistura em OKLab: `t` = peso de `a` (0..1). */
export function mix(a, b, t) {
  const A = toOklab(a); const B = toOklab(b);
  return fromOklab(A.map((v, i) => v * t + B[i] * (1 - t)));
}
export function luminance(h) {
  const [r, g, b] = hex2rgb(h).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Afasta `fg` de `bg` (para preto ou branco) até atingir `min`. */
export function ensure(fg, bg, min) {
  if (contrast(fg, bg) >= min) return fg;
  const target = luminance(bg) > 0.18 ? '#000000' : '#FFFFFF';
  for (let t = 0.96; t >= 0; t -= 0.02) {
    const c = mix(fg, target, t);
    if (contrast(c, bg) >= min) return c;
  }
  return target;
}

// ---------- Tipos de letra ----------
// Ficheiros em public/fonts (só o subconjunto latino, que cobre o português). Licença OFL 1.1.
export const FONTS = {
  'Plex Sans': { file: 'plex-sans.woff2', weight: '100 700' },
  'Plex Mono': [{ file: 'plex-mono-400.woff2', weight: '400' }, { file: 'plex-mono-700.woff2', weight: '700' }],
  'Source Serif': { file: 'source-serif.woff2', weight: '200 900' },
  'Source Sans': { file: 'source-sans.woff2', weight: '200 900' },
  'Space Grotesk': { file: 'space-grotesk.woff2', weight: '300 700' },
  'Space Mono': [{ file: 'space-mono-400.woff2', weight: '400' }, { file: 'space-mono-700.woff2', weight: '700' }],
  Archivo: { file: 'archivo.woff2', weight: '100 900', stretch: '62% 125%' },
  'JetBrains Mono': { file: 'jetbrains-mono.woff2', weight: '100 800' },
  Bricolage: { file: 'bricolage.woff2', weight: '200 800' },
  Figtree: { file: 'figtree.woff2', weight: '300 900' },
  'DM Mono': [{ file: 'dm-mono-400.woff2', weight: '400' }, { file: 'dm-mono-500.woff2', weight: '500 700' }],
  Fraunces: { file: 'fraunces.woff2', weight: '100 900' },
  'Instrument Sans': { file: 'instrument-sans.woff2', weight: '400 700' },
  'Red Hat Display': { file: 'redhat-display.woff2', weight: '300 900' },
  'Red Hat Text': { file: 'redhat-text.woff2', weight: '300 700' },
  'Red Hat Mono': { file: 'redhat-mono.woff2', weight: '300 700' },
  Manrope: { file: 'manrope.woff2', weight: '200 800' },
  'Public Sans': { file: 'public-sans.woff2', weight: '100 900' },
  Newsreader: { file: 'newsreader.woff2', weight: '200 800' },
  Schibsted: { file: 'schibsted.woff2', weight: '400 900' },
  Lexend: { file: 'lexend.woff2', weight: '100 900' },
  Recursive: { file: 'recursive-casl.woff2', weight: '300 1000' },
  'Recursive Mono': { file: 'recursive-mono.woff2', weight: '300 1000' },
};

// ---------- Temas ----------
// light/dark: paper (fundo), sheet (superfícies), ink (texto), accent (ação), owed (em dívida),
// late (atraso/erro), ok (guardado), od/oe (olho direito/esquerdo), top (barra do topo).
// shape: raios, espessura das linhas de secção, forma dos nós do percurso, rótulos.
const T = [
  {
    id: 'laboratorio', name: 'Laboratório',
    about: 'Técnico e frio, cantos vivos, barra de topo escura. IBM Plex.',
    fonts: { head: 'Plex Sans', body: 'Plex Sans', mono: 'Plex Mono' },
    light: { paper: '#F2F3F5', sheet: '#FFFFFF', ink: '#16181D', accent: '#2346C8', owed: '#A15C00', late: '#C0262D', ok: '#1E7A46', od: '#C22F3A', oe: '#1D5FB8', top: '#16181D', topInk: '#FFFFFF', topActive: '#8EA6FF' },
    dark: { paper: '#101216', sheet: '#171A20', ink: '#E6E8EC', accent: '#8EA6FF', owed: '#F0B35A', late: '#FF8A85', ok: '#7FD3A0', od: '#FF8E97', oe: '#8FB8F5', top: '#0A0C0F', topInk: '#E6E8EC', topActive: '#8EA6FF' },
    shape: { r: [2, 3, 4], ruleW: '2px', node: 'square', label: 'caps', headW: 600, headTrack: '-0.01em' },
  },
  {
    id: 'receituario', name: 'Receituário',
    about: 'Papel quente e tinta de caneta; títulos com serifa, filete duplo. Source Serif e Source Sans.',
    fonts: { head: 'Source Serif', body: 'Source Sans', mono: 'Plex Mono' },
    light: { paper: '#F5F0E6', sheet: '#FFFDF8', ink: '#2A2118', accent: '#2B4A7A', owed: '#9B5A12', late: '#A2312B', ok: '#2F6B3D', od: '#A2312B', oe: '#2B4A7A' },
    dark: { paper: '#1A1612', sheet: '#221D18', ink: '#EDE5D8', accent: '#9DB8E6', owed: '#E7B46A', late: '#F09A8C', ok: '#93C99E', od: '#F09A8C', oe: '#9DB8E6' },
    shape: { r: [2, 4, 6], ruleW: '3px', ruleStyle: 'double', node: 'circle', label: 'plain', headW: 600, headTrack: '0' },
  },
  {
    id: 'sala-escura', name: 'Sala escura',
    about: 'Pensado para a eletrofisiologia: fósforo verde sobre preto, sem cantos, nós em losango. Space Grotesk e Space Mono.',
    fonts: { head: 'Space Grotesk', body: 'Space Grotesk', mono: 'Space Mono' },
    light: { paper: '#ECEBE6', sheet: '#FAF9F6', ink: '#1A1A1A', accent: '#3F6212', owed: '#9A5200', late: '#B3123A', ok: '#0E6390', od: '#B3123A', oe: '#1F5FAD' },
    dark: { paper: '#0A0B0A', sheet: '#121412', ink: '#E4E7E1', accent: '#A3E635', owed: '#FBBF5A', late: '#FF7A93', ok: '#67C6F0', od: '#FF7A93', oe: '#7FB0FF' },
    shape: { r: [0, 0, 0], ruleW: '1px', node: 'diamond', label: 'mono', headW: 600, headTrack: '-0.02em', tapeDash: true },
  },
  {
    id: 'snellen', name: 'Snellen',
    about: 'Preto sobre branco, como a escala de optotipos. Títulos condensados, linhas grossas. Archivo e JetBrains Mono.',
    fonts: { head: 'Archivo', body: 'Archivo', mono: 'JetBrains Mono' },
    light: { paper: '#FFFFFF', sheet: '#FFFFFF', ink: '#000000', accent: '#000000', owed: '#8A5A00', late: '#C8102E', ok: '#00703C', od: '#C8102E', oe: '#0047AB', top: '#000000', topInk: '#FFFFFF', topActive: '#FFFFFF' },
    dark: { paper: '#000000', sheet: '#0D0D0D', ink: '#F5F5F5', accent: '#FFFFFF', owed: '#FFC04D', late: '#FF6B7D', ok: '#5BD68E', od: '#FF6B7D', oe: '#7FA9FF', top: '#000000', topInk: '#FFFFFF', topActive: '#FFFFFF' },
    shape: { r: [0, 0, 0], ruleW: '3px', node: 'square', label: 'condensed', headW: 800, headTrack: '-0.01em', headStretch: '78%', sheetBorder: true },
  },
  {
    id: 'ishihara', name: 'Ishihara',
    about: 'Tons das placas pseudoisocromáticas, cantos redondos, padrão de pontos nos bloqueios. Bricolage e Figtree.',
    fonts: { head: 'Bricolage', body: 'Figtree', mono: 'DM Mono' },
    light: { paper: '#F7F1EA', sheet: '#FFFBF6', ink: '#2B2622', accent: '#A03568', owed: '#9A6200', late: '#C02B1E', ok: '#3E7A2E', od: '#C02B1E', oe: '#2E5FA8' },
    dark: { paper: '#1B1714', sheet: '#24201C', ink: '#F2E9DF', accent: '#F08BB8', owed: '#EDBA5B', late: '#FF8F80', ok: '#9FD48B', od: '#FF8F80', oe: '#93B5EE' },
    shape: { r: [6, 10, 16], ruleW: '2px', node: 'circle', label: 'plain', headW: 700, headTrack: '-0.02em', dots: true, soft: true },
  },
  {
    id: 'fundo', name: 'Fundo do olho',
    about: 'Laranja da retina, amarelo do disco, vasos escuros. Fraunces nos títulos, Instrument Sans no texto.',
    fonts: { head: 'Fraunces', body: 'Instrument Sans', mono: 'JetBrains Mono' },
    light: { paper: '#FBF4EF', sheet: '#FFFFFF', ink: '#2A1618', accent: '#A8430F', owed: '#7F6200', late: '#B0182C', ok: '#2E6B3A', od: '#B0182C', oe: '#2D5A9E' },
    dark: { paper: '#1A0F0E', sheet: '#241615', ink: '#F5E6E0', accent: '#FF9A62', owed: '#E9C95C', late: '#FF7E8C', ok: '#93CF9D', od: '#FF7E8C', oe: '#94B6F0' },
    shape: { r: [4, 6, 10], ruleW: '1.5px', node: 'circle', label: 'plain', headW: 600, headTrack: '-0.01em' },
  },
  {
    id: 'cianotipia', name: 'Cianotipia',
    about: 'Azul da Prússia, papel quadriculado como uma planta técnica. Red Hat Display, Text e Mono.',
    fonts: { head: 'Red Hat Display', body: 'Red Hat Text', mono: 'Red Hat Mono' },
    light: { paper: '#EEF2F7', sheet: '#FFFFFF', ink: '#0F2238', accent: '#1B4F9C', owed: '#9A5B00', late: '#B42318', ok: '#22704A', od: '#B42335', oe: '#1B4F9C', top: '#123A73', topInk: '#FFFFFF', topActive: '#FFD666' },
    dark: { paper: '#0B1626', sheet: '#102036', ink: '#DCE7F5', accent: '#7FB2FF', owed: '#F2B95E', late: '#FF8F85', ok: '#7FD1A3', od: '#FF8F9A', oe: '#7FB2FF', top: '#081222', topInk: '#DCE7F5', topActive: '#FFD666' },
    shape: { r: [3, 5, 8], ruleW: '2px', node: 'circle', label: 'caps', headW: 700, headTrack: '-0.01em', grid: true },
  },
  {
    id: 'musgo', name: 'Musgo',
    about: 'Verdes calmos, superfícies suaves sem contorno, cantos largos. Manrope e DM Mono.',
    fonts: { head: 'Manrope', body: 'Manrope', mono: 'DM Mono' },
    light: { paper: '#EEF1EA', sheet: '#FBFCF9', ink: '#1E2A22', accent: '#44663A', owed: '#965A00', late: '#B3332B', ok: '#23647A', od: '#B3332B', oe: '#2F5E9C' },
    dark: { paper: '#121712', sheet: '#1A211B', ink: '#E2E8E0', accent: '#A7C99A', owed: '#EBB765', late: '#FF9488', ok: '#86CBE0', od: '#FF9488', oe: '#9AB9EE' },
    shape: { r: [6, 10, 16], ruleW: '1px', node: 'circle', label: 'plain', headW: 700, headTrack: '-0.02em', soft: true },
  },
  {
    id: 'ardosia', name: 'Ardósia',
    about: 'Cinzento-azulado neutro com violeta como cor de ação. Public Sans e IBM Plex Mono.',
    fonts: { head: 'Public Sans', body: 'Public Sans', mono: 'Plex Mono' },
    light: { paper: '#F0F1F4', sheet: '#FFFFFF', ink: '#1D2130', accent: '#5B45C2', owed: '#9A5700', late: '#BB2A36', ok: '#1F7349', od: '#BB2A36', oe: '#2457B0' },
    dark: { paper: '#13141C', sheet: '#1B1D28', ink: '#E4E5EE', accent: '#B3A6FF', owed: '#EDB45E', late: '#FF8D96', ok: '#80D2A3', od: '#FF8D96', oe: '#93B4F5' },
    shape: { r: [4, 6, 10], ruleW: '1.5px', node: 'circle', label: 'plain', headW: 700, headTrack: '-0.015em' },
  },
  {
    id: 'coimbra', name: 'Coimbra',
    about: 'Negro da capa e dourado; títulos com serifa de jornal. Newsreader e Schibsted Grotesk.',
    fonts: { head: 'Newsreader', body: 'Schibsted', mono: 'Plex Mono' },
    light: { paper: '#F6F3EC', sheet: '#FFFFFF', ink: '#151515', accent: '#23365F', owed: '#9A5800', late: '#B3261E', ok: '#2D6A3A', od: '#B3261E', oe: '#23365F', top: '#151515', topInk: '#F6F3EC', topActive: '#C9A13B' },
    dark: { paper: '#121212', sheet: '#1B1B1A', ink: '#EEEAE0', accent: '#D9B65A', owed: '#F0A65A', late: '#FF8A7F', ok: '#8FCB9B', od: '#FF8A7F', oe: '#9DB4E8', top: '#0A0A0A', topInk: '#EEEAE0', topActive: '#D9B65A' },
    shape: { r: [2, 3, 5], ruleW: '1px', node: 'circle', label: 'caps', headW: 600, headTrack: '0' },
  },
  {
    id: 'lexend', name: 'Lexend',
    about: 'Leitura descansada: letra larga e espaçada, índigo e lilás, cantos redondos. Lexend.',
    fonts: { head: 'Lexend', body: 'Lexend', mono: 'Red Hat Mono' },
    light: { paper: '#F4F2FA', sheet: '#FFFFFF', ink: '#1F1B2E', accent: '#3B47B8', owed: '#965700', late: '#B8283B', ok: '#22704A', od: '#B8283B', oe: '#3B47B8' },
    dark: { paper: '#15131E', sheet: '#1D1A29', ink: '#E9E6F4', accent: '#A9B1FF', owed: '#EDB45E', late: '#FF8D9C', ok: '#80D2A3', od: '#FF8D9C', oe: '#A9B1FF' },
    shape: { r: [6, 10, 14], ruleW: '2px', node: 'circle', label: 'plain', headW: 600, headTrack: '-0.01em', soft: true },
  },
  {
    id: 'caderno', name: 'Caderno',
    about: 'Preto e marcador amarelo, letra com um toque manual. Recursive.',
    fonts: { head: 'Recursive', body: 'Recursive', mono: 'Recursive Mono' },
    light: { paper: '#FAF7F0', sheet: '#FFFFFF', ink: '#222222', accent: '#222222', soft: '#FFE14D', owed: '#9A5B00', late: '#C0262D', ok: '#2F7A3B', od: '#C0262D', oe: '#1F5FAD' },
    dark: { paper: '#181715', sheet: '#21201D', ink: '#F1EEE6', accent: '#FFE14D', owed: '#F5B35C', late: '#FF8A85', ok: '#8FD39A', od: '#FF8A85', oe: '#8FB8F5' },
    shape: { r: [3, 5, 8], ruleW: '2px', node: 'circle', label: 'plain', headW: 750, headTrack: '-0.01em', casual: true },
  },
];

const AA = 4.5; // texto
const UI = 3; // contornos de campos e elementos gráficos (WCAG 1.4.11)

function palette(p, dark) {
  const { paper, sheet, ink } = p;
  const bgs = [paper, sheet];
  const onBoth = (c, min) => { let x = ensure(c, paper, min); x = ensure(x, sheet, min); return x; };
  const ink2 = onBoth(mix(ink, paper, 0.8), AA);
  const ink3 = onBoth(mix(ink, paper, 0.64), AA);
  const accent = onBoth(p.accent, AA);
  const blackOrWhite = (bg) => (contrast('#FFFFFF', bg) >= contrast('#111111', bg) ? '#FFFFFF' : '#111111');
  const accentInk = ensure(blackOrWhite(accent), accent, AA);
  const accentSoft = p.soft && !dark ? p.soft : mix(accent, sheet, dark ? 0.2 : 0.11);
  const tone = (c) => {
    const fill = mix(c, sheet, dark ? 0.18 : 0.12);
    const line = mix(c, sheet, dark ? 0.42 : 0.4);
    const text = ensure(ensure(c, fill, AA), sheet, AA);
    return { c: text, fill, line };
  };
  const owed = tone(p.owed); const late = tone(p.late); const ok = tone(p.ok);
  const owedInk = ensure(mix(owed.c, ink, 0.6), owed.fill, AA);
  const top = p.top || sheet;
  const topInk = ensure(p.topInk || ink, top, AA);
  const topInk2 = ensure(mix(topInk, top, 0.75), top, AA);
  const topActive = ensure(p.topActive || accent, top, UI);
  const ruleStrong = onBoth(mix(ink, paper, 0.36), UI);
  return {
    'color-scheme': dark ? 'dark' : 'light',
    '--paper': paper, '--sheet': sheet, '--sunk': mix(ink, sheet, dark ? 0.07 : 0.055),
    '--ink': ink, '--ink-2': ink2, '--ink-3': ink3,
    '--rule': mix(ink, paper, dark ? 0.2 : 0.16), '--rule-soft': mix(ink, paper, dark ? 0.12 : 0.09), '--rule-strong': ruleStrong,
    '--accent': accent, '--accent-hover': mix(accent, dark ? '#FFFFFF' : '#000000', 0.82), '--accent-ink': accentInk,
    '--accent-soft': accentSoft, '--accent-line': mix(accent, sheet, 0.45),
    '--owed': owed.c, '--owed-ink': owedInk, '--owed-fill': owed.fill, '--owed-line': owed.line, '--owed-mark': ensure(p.owed, sheet, UI),
    '--late': late.c, '--late-fill': late.fill, '--late-line': late.line,
    '--ok': ok.c, '--ok-fill': ok.fill, '--ok-line': ok.line,
    '--od': onBoth(p.od, AA), '--oe': onBoth(p.oe, AA),
    '--focus': ensure(accent, paper, UI),
    '--hatch-a': mix(ink, paper, 0.045), '--hatch-b': mix(ink, paper, 0.1),
    '--top-bg': top, '--top-ink': topInk, '--top-ink-2': topInk2, '--top-active': topActive,
    '--top-hover': mix(topInk, top, 0.08), '--top-line': p.top ? top : mix(ink, paper, 0.16),
    '--mark-bg': accent,
    '--mark-fg': accentInk,
    _bgs: bgs,
  };
}

function shapeVars(t) {
  const s = t.shape;
  const f = (name) => `"${name}", ${/Mono/.test(name) ? 'ui-monospace, Consolas, monospace' : 'system-ui, sans-serif'}`;
  const v = {
    '--f-head': f(t.fonts.head), '--f-body': f(t.fonts.body), '--f-mono': f(t.fonts.mono),
    '--r-xs': `${s.r[0]}px`, '--r': `${s.r[1]}px`, '--r-lg': `${s.r[2]}px`,
    '--rule-w': s.ruleW, '--rule-style': s.ruleStyle || 'solid',
    '--node-r': s.node === 'circle' ? '50%' : '0', '--node-rot': s.node === 'diamond' ? '45deg' : '0deg',
    '--h-w': String(s.headW), '--h-track': s.headTrack, '--h-stretch': s.headStretch || '100%',
    '--label-case': s.label === 'caps' || s.label === 'condensed' || s.label === 'mono' ? 'uppercase' : 'none',
    '--label-size': s.label === 'plain' ? '1.02rem' : s.label === 'condensed' ? '1rem' : '0.8rem',
    '--label-track': s.label === 'plain' ? '0' : s.label === 'condensed' ? '0.01em' : '0.07em',
    '--label-font': s.label === 'mono' ? 'var(--f-mono)' : 'var(--f-head)',
    '--label-stretch': s.label === 'condensed' ? '78%' : '100%',
    '--sheet-border': s.soft ? 'transparent' : 'var(--rule)',
    '--sheet-shadow': s.soft ? '0 1px 2px rgb(0 0 0 / 0.05), 0 4px 16px rgb(0 0 0 / 0.05)' : 'none',
    '--tape-line': s.tapeDash ? 'repeating-linear-gradient(to bottom, var(--rule-strong) 0 4px, transparent 4px 9px)' : 'var(--rule)',
    '--paper-pattern': s.grid ? 'linear-gradient(var(--rule-soft) 1px, transparent 1px), linear-gradient(90deg, var(--rule-soft) 1px, transparent 1px)' : 'none',
    '--paper-pattern-size': s.grid ? '24px 24px' : 'auto',
    '--block-fill': s.dots ? 'radial-gradient(circle, var(--hatch-b) 2.2px, transparent 2.6px) 0 0 / 10px 10px, var(--hatch-a)' : 'repeating-linear-gradient(135deg, var(--hatch-a) 0 7px, var(--hatch-b) 7px 14px)',
    '--body-var': s.casual ? '"CASL" 0.5' : 'normal',
    '--head-var': s.casual ? '"CASL" 1' : 'normal',
  };
  return v;
}

export const THEMES = T.map((t) => ({ ...t, lightVars: palette(t.light, false), darkVars: palette(t.dark, true), shapeVars: shapeVars(t) }));
export const THEME_IDS = THEMES.map((t) => t.id);
export const DEFAULT_THEME = 'laboratorio';
export const MODES = ['auto', 'claro', 'escuro'];
export const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME);

const decl = (vars) => Object.entries(vars).filter(([k]) => !k.startsWith('_')).map(([k, v]) => `${k}:${v}`).join(';');

/** CSS de todos os temas. `[data-mode]` no <html>: auto | claro | escuro. */
export function themesCss() {
  const faces = Object.entries(FONTS).flatMap(([family, spec]) => (Array.isArray(spec) ? spec : [spec]).map((s) =>
    `@font-face{font-family:"${family}";src:url("/static/fonts/${s.file}") format("woff2");font-weight:${s.weight};${s.stretch ? `font-stretch:${s.stretch};` : ''}font-style:normal;font-display:swap}`));
  const out = ['/* Gerado por src/themes.js — não editar à mão. */', ...faces];
  for (const t of THEMES) {
    const sel = `[data-theme="${t.id}"]`;
    out.push(`${sel}{${decl(t.shapeVars)};${decl(t.lightVars)}}`);
    out.push(`${sel}[data-mode="escuro"]{${decl(t.darkVars)}}`);
    out.push(`@media (prefers-color-scheme: dark){${sel}[data-mode="auto"]{${decl(t.darkVars)}}}`);
  }
  return out.join('\n');
}

/** Pares texto/fundo que têm de cumprir AA, para o teste automático. */
export function contrastPairs(vars) {
  const v = (k) => vars[k];
  return [
    ['ink', v('--ink'), v('--paper'), AA], ['ink-3/paper', v('--ink-3'), v('--paper'), AA], ['ink-3/sheet', v('--ink-3'), v('--sheet'), AA],
    ['ink-3/sunk', v('--ink-3'), v('--sunk'), AA - 0.5],
    ['accent/sheet', v('--accent'), v('--sheet'), AA], ['accent/paper', v('--accent'), v('--paper'), AA],
    ['accent-ink/accent', v('--accent-ink'), v('--accent'), AA], ['accent/accent-soft', v('--accent'), v('--accent-soft'), AA],
    ['owed/fill', v('--owed'), v('--owed-fill'), AA], ['owed-ink/fill', v('--owed-ink'), v('--owed-fill'), AA],
    ['late/fill', v('--late'), v('--late-fill'), AA], ['ok/fill', v('--ok'), v('--ok-fill'), AA],
    ['od', v('--od'), v('--sheet'), AA], ['oe', v('--oe'), v('--sheet'), AA],
    ['top-ink', v('--top-ink'), v('--top-bg'), AA], ['top-ink-2', v('--top-ink-2'), v('--top-bg'), AA],
    ['rule-strong', v('--rule-strong'), v('--sheet'), UI], ['top-active', v('--top-active'), v('--top-bg'), UI],
  ];
}
