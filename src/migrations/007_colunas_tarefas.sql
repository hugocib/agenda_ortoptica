-- reconstroi-tabelas
-- v1.9: colunas do quadro de tarefas editáveis (nome, ordem, número). Uma delas é a «de
-- concluídas» (is_done = 1): é para lá que vai o botão «Feito», e as tarefas dessa coluna não
-- aparecem em «Hoje» nem enviam lembretes.
CREATE TABLE task_columns (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  position INTEGER NOT NULL DEFAULT 0,
  is_done INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1))
);
INSERT INTO task_columns (id, name, position, is_done) VALUES
  (1, 'A fazer', 1, 0), (2, 'Em curso', 2, 0), (3, 'À espera de alguém', 3, 0), (4, 'Feito', 4, 1);

CREATE TABLE tasks_new (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  notes TEXT NOT NULL DEFAULT '',
  column_id INTEGER NOT NULL REFERENCES task_columns(id),
  position REAL NOT NULL DEFAULT 0,
  project TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  remind_at TEXT,
  reminded_at TEXT,
  exam_id INTEGER REFERENCES exams(id) ON DELETE SET NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  done_at TEXT
);
INSERT INTO tasks_new (id, title, notes, column_id, position, project, due_date, remind_at, reminded_at, exam_id, created_by, created_at, updated_at, done_at)
  SELECT id, title, notes, CASE col WHEN 'afazer' THEN 1 WHEN 'emcurso' THEN 2 WHEN 'espera' THEN 3 ELSE 4 END,
    position, project, due_date, remind_at, reminded_at, exam_id, created_by, created_at, updated_at, done_at FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;
CREATE INDEX tasks_col ON tasks(column_id, position);
CREATE INDEX tasks_remind ON tasks(remind_at) WHERE reminded_at IS NULL;
CREATE INDEX tasks_exam ON tasks(exam_id);
