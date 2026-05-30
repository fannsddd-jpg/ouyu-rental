CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  backup_at TEXT NOT NULL
);

-- 插入默认设置
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('settings', '{"theme":"light"}', datetime('now'));
