-- reconstroi-tabelas
-- v1.5: avaliações de investigação e informação clínica do requisitante.
--
-- Atos/MCDTs passam a ter um tipo: «clinico» (exames externos, reservas do secretariado) ou
-- «investigacao» (avaliações de participantes de projetos, marcadas a qualquer hora do horário
-- de trabalho e nunca oferecidas no link do secretariado).
ALTER TABLE exam_types ADD COLUMN kind TEXT NOT NULL DEFAULT 'clinico' CHECK (kind IN ('clinico', 'investigacao'));
UPDATE exam_types SET kind = 'investigacao' WHERE code IN ('refracao_fmri', 'aval_visual');

-- Pedidos: novo circuito «investigacao». O participante fica identificado só pelo código do
-- estudo (guardado em patient_process; sem nome nem data de nascimento). Informação clínica =
-- suspeita/observações do médico requisitante, para o relatório (preenchida pelo ortoptista).
CREATE TABLE requests_new (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'direto' CHECK (source IN ('direto', 'secretariado', 'investigacao')),
  patient_process TEXT NOT NULL DEFAULT '',
  patient_name TEXT NOT NULL DEFAULT '',
  birth_date TEXT,
  origin TEXT NOT NULL DEFAULT 'externo' CHECK (origin IN ('externo', 'projeto', 'ensaio')),
  project TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgente')),
  notes TEXT NOT NULL DEFAULT '',
  clinical_info TEXT NOT NULL DEFAULT '',
  booked_by_name TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (source = 'secretariado' OR patient_process <> ''),
  CHECK (source <> 'investigacao' OR (project <> '' AND patient_name = '' AND birth_date IS NULL))
);
INSERT INTO requests_new (id, source, patient_process, patient_name, birth_date, origin, project, referrer, priority, notes, booked_by_name, created_by, created_at)
  SELECT id, source, patient_process, patient_name, birth_date, origin, project, referrer, priority, notes, booked_by_name, created_by, created_at FROM requests;
DROP TABLE requests;
ALTER TABLE requests_new RENAME TO requests;
CREATE INDEX requests_source ON requests(source);
