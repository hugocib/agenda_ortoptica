import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { formFromTemplate } from './domain/reports.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(here, 'migrations');

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  seed(db);
  fillForms(db);
  return db;
}

// Migrações numeradas e aplicadas uma só vez, cada uma numa transação.
export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').pluck().all());
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    // Migrações que reconstroem tabelas (SQLite não altera CHECKs) correm com as chaves externas
    // desligadas e confirmam no fim que nenhuma referência ficou partida.
    const rebuild = sql.includes('-- reconstroi-tabelas');
    if (rebuild) db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(sql);
        if (rebuild) {
          const broken = db.pragma('foreign_key_check');
          if (broken.length) throw new Error(`Migração ${f}: ${broken.length} referências partidas`);
        }
        db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(f);
      })();
    } finally {
      if (rebuild) db.pragma('foreign_keys = ON');
    }
  }
}

// Tipos de exame iniciais. minutos = duração com preparação. Editáveis em Administração.
export const DEFAULT_EXAM_TYPES = [
  ['erg', 'ERG campo total (ISCEV)', 90, 1, 'erg'],
  ['erg_pattern', 'ERG pattern / multifocal', 75, 1, 'erg_pattern'],
  ['pev', 'PEV pattern / flash', 60, 1, 'pev'],
  ['eog', 'EOG', 75, 1, 'eog'],
  ['oct', 'OCT segmento posterior', 20, 0, 'oct'],
  ['oct_ant', 'OCT segmento anterior', 20, 0, 'oct'],
  ['micro', 'Microperimetria (MP-3S)', 30, 0, 'microperimetria'],
  ['csf', 'Sensibilidade ao contraste (Metropsis)', 40, 0, 'metropsis'],
  ['ortoptica', 'Avaliação ortóptica / visão binocular', 40, 0, 'ortoptica'],
  ['retino', 'Retinografia', 15, 0, 'retinografia'],
  ['eyetracking', 'Oculomotricidade por eye-tracking (GazeLab)', 40, 0, 'eyetracking'],
  ['ensaio', 'Visita de ensaio clínico', 120, 0, 'generico'],
  ['refracao_fmri', 'Refração e correção para fMRI', 20, 0, 'refracao'],
  ['aval_visual', 'Avaliação visual completa (participante)', 60, 0, 'ortoptica'],
];

// Avaliações de investigação (não aparecem no link do secretariado nem nos pedidos clínicos).
export const RESEARCH_CODES = new Set(['refracao_fmri', 'aval_visual']);

export const DEFAULT_SETTINGS = {
  // weekday: 1 = segunda ... 5 = sexta
  // Manhã e tarde são janelas separadas; o intervalo entre elas é o almoço (nunca tem vagas).
  availability: [2, 4].flatMap((weekday) => [
    { weekday, start: '09:00', end: '13:00' },
    { weekday, start: '14:00', end: '17:00' },
  ]),
  slot_step_min: 15,
  horizon_weeks: 8,
  report_header: ['Universidade de Coimbra · CIBIT-ICNAS', 'Laboratório de Ortóptica e Função Visual'],
  report_signer: 'Ortoptista',
  report_signer_id: 'Cédula profissional n.º ______',
  report_medical_line: true,
  theme: 'laboratorio',
  // A página de reservas tem tema próprio e fixo: não muda quando o ortoptista muda o seu.
  booking_theme: 'laboratorio',
  // Nomes de quem reserva pelo link do secretariado (lista curta, escolhida ao reservar).
  booking_names: [],
  // Logotipo dos relatórios (data URL; vazio = sem logotipo).
  report_logo: '',
};

export function seed(db) {
  const count = db.prepare('SELECT COUNT(*) FROM exam_types').pluck().get();
  if (count === 0) {
    const ins = db.prepare(`INSERT INTO exam_types (code, name, minutes, is_electro, report_template, sort, max_per_day, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    // Eletrofisiologia: no máximo 2 de cada por dia (editável em Atos / MCDTs).
    db.transaction(() => DEFAULT_EXAM_TYPES.forEach((t, i) => ins.run(...t, i, t[3] ? 2 : null, RESEARCH_CODES.has(t[0]) ? 'investigacao' : 'clinico')))();
  }
  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, JSON.stringify(v));
  insSetting.run('ics_token', JSON.stringify(crypto.randomBytes(24).toString('base64url')));
  insSetting.run('booking_token', JSON.stringify(crypto.randomBytes(18).toString('base64url')));
}

/**
 * Atos sem ficha recebem uma cópia do modelo que usavam, com os normativos antigos (que estavam
 * por modelo, em «norms»). Depois da conversão, os normativos vivem só na ficha de cada ato.
 */
export function fillForms(db) {
  const missing = db.prepare('SELECT id, report_template FROM exam_types WHERE form IS NULL').all();
  if (!missing.length) return;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'norms'").get();
  const oldNorms = row ? JSON.parse(row.value) : {};
  const up = db.prepare('UPDATE exam_types SET form = ? WHERE id = ?');
  db.transaction(() => {
    for (const t of missing) up.run(JSON.stringify(formFromTemplate(t.report_template, oldNorms)), t.id);
    db.prepare("DELETE FROM settings WHERE key = 'norms'").run();
  })();
}

export function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return DEFAULT_SETTINGS[key];
  return JSON.parse(row.value);
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

export function audit(db, userId, action, entity, entityId = null, detail = null) {
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
    .run(userId ?? null, action, entity, entityId, detail == null ? null : JSON.stringify(detail));
}
