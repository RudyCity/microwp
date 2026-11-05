import type {Env} from "../types";

/** WordPress configuration is generated inside ephemeral PHP MEMFS, never under Worker assets. */
const QUOTE = (s:string) => "'"+s.replaceAll("\\","\\\\").replaceAll("'","\\'").replaceAll("\r","").replaceAll("\n","")+"'";
export function wordpressConfig(origin:string,env:Env):string {
  const url=new URL(origin);
  const home=env.WP_PUBLIC_URL ? new URL(env.WP_PUBLIC_URL).origin : url.origin;
  const salts=["AUTH_KEY","SECURE_AUTH_KEY","LOGGED_IN_KEY","NONCE_KEY","AUTH_SALT","SECURE_AUTH_SALT","LOGGED_IN_SALT","NONCE_SALT"];
  const saltLines=salts.map(key=>`define(${QUOTE(key)},${QUOTE(env.WP_SECRET_KEY ? env.WP_SECRET_KEY+":"+key : crypto.randomUUID()+crypto.randomUUID()+key)});`);
  return `<?php
define('DB_NAME', 'microwp');
define('DB_USER', 'unused');
define('DB_PASSWORD', 'unused');
define('DB_HOST', 'unused');
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');
define('DB_ENGINE', 'sqlite');
define('DB_PATH', '/private/microwp.sqlite');
define('SQLITE_JOURNAL_MODE','delete');
define('WP_HOME',${QUOTE(home)});
define('WP_SITEURL',${QUOTE(home)});
ini_set('display_errors','0');
ini_set('html_errors','0');
define('WP_DEBUG',false);
define('WP_DEBUG_DISPLAY',false);
define('WP_MEMORY_LIMIT','64M');
define('DISABLE_WP_CRON',true);
define('DISALLOW_FILE_EDIT',true);
define('DISALLOW_FILE_MODS',true);
${saltLines.join("\n")}
\$table_prefix = 'wp_';
if (!defined('ABSPATH')) define('ABSPATH',__DIR__.'/');
require_once ABSPATH . 'wp-settings.php';
`;
}
export function mayServePreview(url: URL, env:Env):boolean {
  // Hard safety gate: no persistent DB yet, so never expose an ephemeral live WP install.
  return url.hostname==="localhost" || url.hostname==="127.0.0.1";
}
