-- LOCAL FREE-TIER PREVIEW ONLY; no remote application.
-- Only a trusted offline publishing process may write these rows.
CREATE TABLE IF NOT EXISTS microwp_free_posts (
  slug TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','published')),
  published_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS microwp_free_posts_published
  ON microwp_free_posts(status, published_at DESC);
