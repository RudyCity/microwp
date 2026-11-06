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
