-- Isolated local D1 fixture; never execute against Cloudflare remote D1.
CREATE TABLE wp_options (
 site_id TEXT NOT NULL,
 option_name TEXT NOT NULL,
 option_value TEXT NOT NULL,
 autoload TEXT NOT NULL,
 PRIMARY KEY (site_id,option_name)
);
WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n < 64)
INSERT INTO wp_options(site_id,option_name,option_value,autoload)
SELECT 'site_a','option_' || printf('%04d', n),'value_' || n,
 CASE WHEN n % 2 = 0 THEN 'yes' ELSE 'auto' END FROM seq;
WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n < 64)
INSERT INTO wp_options(site_id,option_name,option_value,autoload)
SELECT 'site_b','option_' || printf('%04d', n),'private_' || n,'yes' FROM seq;
