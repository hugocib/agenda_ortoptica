import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

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
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(f);
    })();
  }
}

// Preçário proposto no plano de negócios (out. 2026). Editável em Administração.
// minutos = duração com preparação; preços em cêntimos.
export const DEFAULT_EXAM_TYPES = [
  ['erg', 'ERG campo total (ISCEV)', '70320', 90, 15000, 1, 'erg'],
  ['erg_pattern', 'ERG pattern / multifocal', '', 75, 16000, 1, 'erg_pattern'],
  ['pev', 'PEV pattern / flash', '63310', 60, 14500, 1, 'pev'],
  ['eog', 'EOG', '70310', 75, 14000, 1, 'eog'],
  ['oct', 'OCT segmento posterior', '70279', 20, 9000, 0, 'oct'],
  ['oct_ant', 'OCT segmento anterior', '70278', 20, 9000, 0, 'oct'],
  ['micro', 'Microperimetria (MP-3S)', '', 30, 11000, 0, 'microperimetria'],
  ['csf', 'Sensibilidade ao contraste (Metropsis)', '70412', 40, 6500, 0, 'metropsis'],
  ['ortoptica', 'Avaliação ortóptica / visão binocular', '', 40, 4500, 0, 'ortoptica'],
  ['retino', 'Retinografia', '', 15, 3500, 0, 'retinografia'],
  ['eyetracking', 'Oculomotricidade por eye-tracking (GazeLab)', '', 40, 7000, 0, 'eyetracking'],
  ['ensaio', 'Visita de ensaio clínico', '', 120, 30000, 0, 'generico'],
  ['refracao_fmri', 'Refração e correção para fMRI', '', 20, 3500, 0, 'refracao'],
  ['aval_visual', 'Avaliação visual completa (participante)', '', 60, 9000, 0, 'ortoptica'],
];

export const DEFAULT_SETTINGS = {
  // weekday: 1 = segunda ... 5 = sexta
  availability: [
    { weekday: 2, start: '09:00', end: '12:30' },
    { weekday: 4, start: '09:00', end: '12:30' },
  ],
  slot_step_min: 15,
  max_electro_per_day: 2,
  horizon_weeks: 8,
  report_header: ['Universidade de Coimbra · CIBIT-ICNAS', 'Laboratório de Ortóptica e Função Visual'],
  report_signer: 'Ortoptista',
  report_signer_id: 'Cédula profissional n.º ______',
  report_medical_line: true,
  norms: {},
  theme: 'laboratorio',
};

export function seed(db) {
  const count = db.prepare('SELECT COUNT(*) FROM exam_types').pluck().get();
  if (count === 0) {
    const ins = db.prepare(`INSERT INTO exam_types (code, name, sap_code, minutes, price_cents, is_electro, report_template, sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    db.transaction(() => DEFAULT_EXAM_TYPES.forEach((t, i) => ins.run(...t, i)))();
  }
  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, JSON.stringify(v));
  insSetting.run('ics_token', JSON.stringify(crypto.randomBytes(24).toString('base64url')));
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
