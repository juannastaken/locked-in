-- v8: standalone to-do tasks (Tasks tab)
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  due_at TEXT,
  done_at TEXT,
  created_at TEXT NOT NULL
);
