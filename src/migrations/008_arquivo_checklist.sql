-- v1.10: tarefas com arquivo, lixeira e checklist.
-- archived_at: fora do quadro (as concluídas há mais de 14 dias vão sozinhas); reabre-se.
-- deleted_at: na lixeira; apagadas de vez 30 dias depois (ou ao esvaziar a lixeira).
ALTER TABLE tasks ADD COLUMN archived_at TEXT;
ALTER TABLE tasks ADD COLUMN deleted_at TEXT;
CREATE INDEX tasks_archived ON tasks(archived_at);
CREATE INDEX tasks_deleted ON tasks(deleted_at);

CREATE TABLE task_items (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 200),
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX task_items_task ON task_items(task_id, position);
