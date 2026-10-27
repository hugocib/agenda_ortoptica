-- Esquema inicial. Nunca editar uma migração já aplicada: criar 002_*.sql, 003_*.sql, ...
-- Datas de marcação: hora local de Lisboa no formato 'YYYY-MM-DDTHH:MM' (relógio de parede).
-- Carimbos de auditoria: UTC ISO 8601.

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ortoptista', 'secretariado')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE exam_types (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sap_code TEXT NOT NULL DEFAULT '',
  minutes INTEGER NOT NULL CHECK (minutes BETWEEN 5 AND 480),
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  is_electro INTEGER NOT NULL DEFAULT 0 CHECK (is_electro IN (0, 1)),
  report_template TEXT NOT NULL DEFAULT 'generico',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE requests (
  id INTEGER PRIMARY KEY,
  patient_process TEXT NOT NULL,
  patient_name TEXT NOT NULL DEFAULT '',
  birth_date TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('externo', 'projeto', 'ensaio')),
  project TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgente')),
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Um exame = um tipo de exame dentro de um pedido. Preço, duração e eletrofisiologia
-- são copiados do tipo no momento do pedido, para que mudar o preçário não altere o histórico.
CREATE TABLE exams (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  exam_type_id INTEGER NOT NULL REFERENCES exam_types(id),
  status TEXT NOT NULL DEFAULT 'por_agendar'
    CHECK (status IN ('por_agendar', 'agendado', 'realizado', 'faltou', 'cancelado')),
  starts_at TEXT,
  ends_at TEXT,
  price_cents INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  is_electro INTEGER NOT NULL,
  siima_booked_at TEXT,
  siima_booked_by INTEGER REFERENCES users(id),
  performed_at TEXT,
  siima_registered_at TEXT,
  siima_registered_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (status NOT IN ('agendado', 'realizado', 'faltou') OR (starts_at IS NOT NULL AND ends_at IS NOT NULL)),
  CHECK (status <> 'por_agendar' OR starts_at IS NULL),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (siima_registered_at IS NULL OR status = 'realizado')
);
CREATE INDEX exams_starts_at ON exams(starts_at);
CREATE INDEX exams_status ON exams(status);
CREATE INDEX exams_request ON exams(request_id);

CREATE TABLE blocks (
  id INTEGER PRIMARY KEY,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (ends_at > starts_at)
);
CREATE INDEX blocks_starts_at ON blocks(starts_at);

-- O relatório validado guarda uma cópia fixa (final_html): mudar modelos ou normativos
-- mais tarde não altera relatórios já assinados.
CREATE TABLE reports (
  id INTEGER PRIMARY KEY,
  exam_id INTEGER NOT NULL UNIQUE REFERENCES exams(id),
  template TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  conclusion TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'validado')),
  final_html TEXT,
  validated_at TEXT,
  validated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (status <> 'validado' OR final_html IS NOT NULL)
);

CREATE TABLE report_history (
  id INTEGER PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES reports(id),
  final_html TEXT NOT NULL,
  validated_at TEXT NOT NULL,
  validated_by INTEGER REFERENCES users(id),
  reopened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  reopened_by INTEGER REFERENCES users(id)
);

-- Auditoria: quem fez o quê e quando. Sem nomes de doentes no campo detail.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  detail TEXT
);
CREATE INDEX audit_entity ON audit_log(entity, entity_id);
