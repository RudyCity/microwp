-- Experimental microWP D1-backed PHP-SQLite compatibility bridge.
-- D1 owns transactional durable snapshots, while PHP PDO uses ephemeral SQLite inside WASM.
-- This is NOT native D1 SQL execution for WordPress tables.
CREATE TABLE IF NOT EXISTS microwp_db_snapshots (
  site_id TEXT PRIMARY KEY,
  revision TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes > 0 AND bytes <= 8388608),
  sha256 TEXT NOT NULL,
  parts INTEGER NOT NULL CHECK (parts > 0 AND parts <= 32)
);
CREATE TABLE IF NOT EXISTS microwp_db_chunks (
  site_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  part INTEGER NOT NULL,
  payload BLOB NOT NULL,
  PRIMARY KEY (site_id, revision, part)
);
