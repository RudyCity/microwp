-- Crash-recoverable journal for WordPress media deletion.
-- Written atomically with the D1 SQLite snapshot manifest and chunks.
-- Only objects previously validated as wp-content/uploads/ media may be enqueued.
CREATE TABLE IF NOT EXISTS microwp_media_delete_journal (
  site_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  PRIMARY KEY (site_id, object_key)
);
