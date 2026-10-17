-- The teaching REST API has its own users, sessions and content.
CREATE TABLE IF NOT EXISTS lesson_users (
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'admin'))
) STRICT;
CREATE TABLE IF NOT EXISTS lesson_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES lesson_users(id),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 8 AND 180),
  body TEXT NOT NULL CHECK (length(body) <= 2000),
  category TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS lesson_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES lesson_items(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES lesson_users(id),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 5 AND 2000),
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS lesson_sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES lesson_users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS lesson_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE INDEX IF NOT EXISTS idx_lesson_items_author ON lesson_items(author_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lesson_items_category ON lesson_items(category, created_at);
CREATE INDEX IF NOT EXISTS idx_lesson_records_item ON lesson_records(item_id);
CREATE INDEX IF NOT EXISTS idx_lesson_records_author ON lesson_records(author_id, rating);
