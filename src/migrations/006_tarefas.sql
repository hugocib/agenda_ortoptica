-- v1.7: quadro de tarefas (experiência; pode desligar-se em Administração → Sistema).
-- As tarefas são do ortoptista e nunca mudam o estado de exames: a ligação a um exame é só
-- uma referência. Colunas livres (a fazer, em curso, à espera, feito), ordem dentro da coluna,
-- projeto, prazo e lembrete por notificação.
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  notes TEXT NOT NULL DEFAULT '',
  col TEXT NOT NULL DEFAULT 'afazer' CHECK (col IN ('afazer', 'emcurso', 'espera', 'feito')),
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
CREATE INDEX tasks_col ON tasks(col, position);
CREATE INDEX tasks_remind ON tasks(remind_at) WHERE reminded_at IS NULL;
CREATE INDEX tasks_exam ON tasks(exam_id);
