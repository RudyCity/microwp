-- Never apply this fixture to a production or remote Cloudflare D1 database.
CREATE TABLE wp_options (
  site_id TEXT NOT NULL,
  option_name TEXT NOT NULL,
  option_value TEXT NOT NULL,
  autoload TEXT NOT NULL,
  UNIQUE(site_id,option_name)
);
INSERT INTO wp_options (site_id,option_name,option_value,autoload)
VALUES ('site_b','shared','site_b_private','on');

CREATE TABLE wp_posts (
  site_id TEXT NOT NULL,
  ID INTEGER NOT NULL,
  post_author INTEGER NOT NULL,
  post_date TEXT NOT NULL,
  post_date_gmt TEXT NOT NULL,
  post_content TEXT NOT NULL,
  post_title TEXT NOT NULL,
  post_excerpt TEXT NOT NULL,
  post_status TEXT NOT NULL,
  comment_status TEXT NOT NULL,
  ping_status TEXT NOT NULL,
  post_password TEXT NOT NULL,
  post_name TEXT NOT NULL,
  to_ping TEXT NOT NULL,
  pinged TEXT NOT NULL,
  post_modified TEXT NOT NULL,
  post_modified_gmt TEXT NOT NULL,
  post_content_filtered TEXT NOT NULL,
  post_parent INTEGER NOT NULL,
  guid TEXT NOT NULL,
  menu_order INTEGER NOT NULL,
  post_type TEXT NOT NULL,
  post_mime_type TEXT NOT NULL,
  comment_count INTEGER NOT NULL,
  UNIQUE(site_id,ID)
);
INSERT INTO wp_posts VALUES
('site_a',1,7,'2026-11-06 00:00:00','2026-11-06 00:00:00','body_a','Alpha','','publish','open','open','','alpha','','','2026-11-06 00:00:00','2026-11-06 00:00:00','',0,'https://example.test/?p=1',0,'post','',0),
('site_a',3,7,'2026-11-06 00:00:00','2026-11-06 00:00:00','body_g','Gamma','','draft','open','open','','gamma','','','2026-11-06 00:00:00','2026-11-06 00:00:00','',0,'https://example.test/?p=3',0,'post','',0),
('site_b',2,9,'2026-11-06 00:00:00','2026-11-06 00:00:00','PRIVATE','Private B','','publish','open','open','','private-b','','','2026-11-06 00:00:00','2026-11-06 00:00:00','',0,'https://private.test/?p=2',0,'post','',0);

CREATE TABLE wp_postmeta (
  site_id TEXT NOT NULL,
  meta_id INTEGER NOT NULL,
  post_id INTEGER NOT NULL,
  meta_key TEXT,
  meta_value TEXT,
  UNIQUE(site_id,meta_id)
);
INSERT INTO wp_postmeta VALUES
('site_a',10,1,'color','blue'),
('site_a',11,1,'empty',''),
('site_a',12,3,NULL,NULL),
('site_b',10,2,'secret','PRIVATE');

CREATE TABLE wp_users (
  site_id TEXT NOT NULL,
  ID INTEGER NOT NULL,
  user_login TEXT NOT NULL,
  user_pass TEXT NOT NULL,
  user_status INTEGER NOT NULL,
  UNIQUE(site_id,user_login)
);
INSERT INTO wp_users VALUES
('site_a',1,'admin','$P$hash_a',0),
('site_b',2,'admin','$P$PRIVATE_B',0);

CREATE TABLE wp_usermeta (
  site_id TEXT NOT NULL,
  umeta_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  meta_key TEXT,
  meta_value TEXT,
  UNIQUE(site_id,umeta_id)
);
INSERT INTO wp_usermeta VALUES
('site_a',10,1,'nickname','Admin A'),
('site_a',11,1,'empty',''),
('site_a',12,1,NULL,NULL),
('site_b',10,2,'secret','PRIVATE');

CREATE TABLE wp_terms (
  site_id TEXT NOT NULL,
  term_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  UNIQUE(site_id,term_id)
);
CREATE TABLE wp_term_taxonomy (
  site_id TEXT NOT NULL,
  term_taxonomy_id INTEGER NOT NULL,
  term_id INTEGER NOT NULL,
  taxonomy TEXT NOT NULL,
  description TEXT NOT NULL,
  parent INTEGER NOT NULL,
  count INTEGER NOT NULL,
  UNIQUE(site_id,term_taxonomy_id)
);
CREATE TABLE wp_term_relationships (
  site_id TEXT NOT NULL,
  object_id INTEGER NOT NULL,
  term_taxonomy_id INTEGER NOT NULL,
  term_order INTEGER NOT NULL,
  UNIQUE(site_id,object_id,term_taxonomy_id)
);
INSERT INTO wp_terms VALUES
('site_a',1,'News','news'),
('site_a',2,'Featured','featured'),
('site_b',1,'PRIVATE','private');
INSERT INTO wp_term_taxonomy VALUES
('site_a',10,1,'category','News category',0,2),
('site_a',11,2,'post_tag','Featured tag',0,1),
('site_b',10,1,'category','PRIVATE',0,1);
INSERT INTO wp_term_relationships VALUES
('site_a',1,10,0),
('site_a',1,11,1),
('site_a',3,10,0),
('site_b',2,10,0);
