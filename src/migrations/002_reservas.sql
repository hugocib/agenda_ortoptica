-- reconstroi-tabelas
-- v1.2: reservas do secretariado por link (sem dados de doentes), dois circuitos,
-- n.º de requisição do Siima por exame, pedidos de alteração; sem códigos SAP nem preços.

-- Tipos de exame: a faturação é do secretariado; a app deixa de guardar SAP e preços.
ALTER TABLE exam_types DROP COLUMN sap_code;
ALTER TABLE exam_types DROP COLUMN price_cents;

-- Pedidos: «direto» = criado pelo ortoptista (exames fora do circuito, com o percurso completo
-- no Siima); «secretariado» = reserva feita pelo link, sem identificação do doente.
CREATE TABLE requests_new (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'direto' CHECK (source IN ('direto', 'secretariado')),
  patient_process TEXT NOT NULL DEFAULT '',
  patient_name TEXT NOT NULL DEFAULT '',
  birth_date TEXT,
  origin TEXT NOT NULL DEFAULT 'externo' CHECK (origin IN ('externo', 'projeto', 'ensaio')),
  project TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgente')),
  notes TEXT NOT NULL DEFAULT '',
  booked_by_name TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (source = 'secretariado' OR patient_process <> '')
);
INSERT INTO requests_new (id, source, patient_process, patient_name, birth_date, origin, project, referrer, priority, notes, created_by, created_at)
  SELECT id, 'direto', patient_process, patient_name, birth_date, origin, project, referrer, priority, notes, created_by, created_at FROM requests;
DROP TABLE requests;
ALTER TABLE requests_new RENAME TO requests;

-- Exames: novos estados «pendente» (reserva por confirmar) e «recusado»; pedido de alteração
-- guardado no próprio exame (a hora proposta fica reservada até ser aceite ou recusada).
CREATE TABLE exams_new (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  exam_type_id INTEGER NOT NULL REFERENCES exam_types(id),
  status TEXT NOT NULL DEFAULT 'por_agendar'
    CHECK (status IN ('pendente', 'por_agendar', 'agendado', 'realizado', 'faltou', 'cancelado', 'recusado')),
  starts_at TEXT,
  ends_at TEXT,
  minutes INTEGER NOT NULL,
  is_electro INTEGER NOT NULL,
  requisition TEXT NOT NULL DEFAULT '',
  confirmed_at TEXT,
  confirmed_by INTEGER REFERENCES users(id),
  decision_note TEXT NOT NULL DEFAULT '',
  change_kind TEXT CHECK (change_kind IN ('mover', 'cancelar')),
  change_starts_at TEXT,
  change_ends_at TEXT,
  change_by_name TEXT NOT NULL DEFAULT '',
  change_requested_at TEXT,
  siima_booked_at TEXT,
  siima_booked_by INTEGER REFERENCES users(id),
  performed_at TEXT,
  siima_registered_at TEXT,
  siima_registered_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (status NOT IN ('pendente', 'agendado', 'realizado', 'faltou') OR (starts_at IS NOT NULL AND ends_at IS NOT NULL)),
  CHECK (status <> 'por_agendar' OR starts_at IS NULL),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (siima_registered_at IS NULL OR status = 'realizado'),
  CHECK (change_kind IS NULL OR status IN ('pendente', 'agendado')),
  CHECK (change_kind IS NOT 'mover' OR (change_starts_at IS NOT NULL AND change_ends_at > change_starts_at))
);
INSERT INTO exams_new (id, request_id, exam_type_id, status, starts_at, ends_at, minutes, is_electro, confirmed_at,
    siima_booked_at, siima_booked_by, performed_at, siima_registered_at, siima_registered_by, created_at, updated_at)
  SELECT id, request_id, exam_type_id, status, starts_at, ends_at, minutes, is_electro,
    CASE WHEN status IN ('agendado', 'realizado', 'faltou') THEN updated_at END,
    siima_booked_at, siima_booked_by, performed_at, siima_registered_at, siima_registered_by, created_at, updated_at FROM exams;
DROP TABLE exams;
ALTER TABLE exams_new RENAME TO exams;
CREATE INDEX exams_starts_at ON exams(starts_at);
CREATE INDEX exams_status ON exams(status);
CREATE INDEX exams_request ON exams(request_id);
CREATE INDEX exams_change ON exams(change_starts_at) WHERE change_kind = 'mover';

-- Notificações push (uma linha por dispositivo onde foram ativadas).
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
