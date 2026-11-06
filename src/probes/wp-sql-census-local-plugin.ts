/**
 * LOCAL-ONLY fixed WordPress MU-plugin for executed wpdb query-shape census.
 * Never install on staging/production. Persists only categorical SQL shapes
 * and aggregate counts, not SQL literals, table names outside the core list,
 * stack traces, auth data, cookies, text content or query timing.
 * WordPress bootstrap before mu-plugin loading remains unobserved.
 */
export const LOCAL_SQL_CENSUS_PATH="/private/microwp-r36-sql-census.jsonl";
export const LOCAL_SQL_CENSUS_PLUGIN=String.raw`<?php
/* Local-only WordPress wpdb query shape census. No SQL text leaves PHP. */
if (!defined('ABSPATH') || !function_exists('add_filter')) return;
$GLOBALS['microwp_r36_total'] = 0;
$GLOBALS['microwp_r36_shapes'] = array();
$GLOBALS['microwp_r36_overflow'] = false;
function microwp_r36_shape($sql) {
  if (!is_string($sql) || strlen($sql) > 131072) return 'OVERSIZE';
  if (!preg_match('/^\s*(SELECT|INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|SHOW|DESCRIBE|PRAGMA|BEGIN|COMMIT|ROLLBACK|EXPLAIN|SET|START)\b/i', $sql, $match)) return 'UNKNOWN';
  $verb = strtoupper($match[1]);
  $tableKinds = array();
  $core = array('options','posts','postmeta','users','usermeta','terms','termmeta','term_taxonomy','term_relationships','comments','commentmeta','links');
  if (preg_match_all('/\b(?:FROM|JOIN|INTO|TABLE)\s+[\x60"]?([A-Za-z_][A-Za-z0-9_]{0,62})[\x60"]?/i', $sql, $matched, PREG_SET_ORDER)) {
    foreach ($matched as $part) {
      $name = strtolower($part[1]);
      $base = substr($name, 3);
      $kind = strpos($name, 'wp_') === 0 && in_array($base, $core, true)
        ? 'core:'.$base : (strpos($name, '_wp_sqlite_') === 0 ? 'sqlite-metadata'
        : (strpos($name, 'wp_') === 0 ? 'other-wp-table' : 'other-table'));
      $tableKinds[$kind] = true;
      if (count($tableKinds) > 8) break;
    }
  }
  // UPDATE is a table keyword only at statement start. In
  // INSERT ... ON DUPLICATE KEY UPDATE it is an assignment clause instead.
  if ($verb === 'UPDATE' && preg_match('/^\s*UPDATE\s+[\x60"]?([A-Za-z_][A-Za-z0-9_]{0,62})[\x60"]?/i', $sql, $u)) {
    $name = strtolower($u[1]);
    $base = substr($name, 3);
    $kind = strpos($name, 'wp_') === 0 && in_array($base, $core, true)
      ? 'core:'.$base : (strpos($name, 'wp_') === 0 ? 'other-wp-table' : 'other-table');
    $tableKinds[$kind] = true;
  }
  if ($verb === 'DESCRIBE' && preg_match('/^\s*DESCRIBE\s+[\x60"]?([A-Za-z_][A-Za-z0-9_]{0,62})[\x60"]?/i', $sql, $d)) {
    $name = strtolower($d[1]);
    $base = substr($name, 3);
    $kind = strpos($name, 'wp_') === 0 && in_array($base, $core, true)
      ? 'core:'.$base : (strpos($name, 'wp_') === 0 ? 'other-wp-table' : 'other-table');
    $tableKinds[$kind] = true;
  }
  $features = array();
  foreach (array(
    'WHERE'=>'/\bWHERE\b/i', 'JOIN'=>'/\bJOIN\b/i', 'GROUP'=>'/\bGROUP\s+BY\b/i',
    'ORDER'=>'/\bORDER\s+BY\b/i', 'LIMIT'=>'/\bLIMIT\b/i',
    'DISTINCT'=>'/\bDISTINCT\b/i', 'UNION'=>'/\bUNION\b/i',
    'ON_CONFLICT'=>'/\bON\s+CONFLICT\b/i',
    'ON_DUPLICATE'=>'/\bON\s+DUPLICATE\s+KEY\b/i',
    'SUBQUERY'=>'/\(\s*SELECT\b/i', 'IN'=>'/\bIN\s*\(/i',
    'LIKE'=>'/\bLIKE\b/i', 'CAST'=>'/\bCAST\s*\(/i',
    'COUNT'=>'/\bCOUNT\s*\(/i', 'FOR_UPDATE'=>'/\bFOR\s+UPDATE\b/i'
  ) as $label=>$pattern) if (preg_match($pattern, $sql)) $features[] = $label;
  $names = array_keys($tableKinds);
  sort($names, SORT_STRING);
  return $verb.'|'.(count($names) ? implode('+',$names) : 'none').'|'.
    (count($features) ? implode('+',$features) : 'simple');
}
add_filter('query', function($query) {
  $GLOBALS['microwp_r36_total']++;
  if ($GLOBALS['microwp_r36_total'] > 2048) {
    $GLOBALS['microwp_r36_overflow']=true;
    return $query;
  }
  $shape = microwp_r36_shape($query);
  if (isset($GLOBALS['microwp_r36_shapes'][$shape])) {
    $GLOBALS['microwp_r36_shapes'][$shape]++;
  } else if (count($GLOBALS['microwp_r36_shapes']) < 128) {
    $GLOBALS['microwp_r36_shapes'][$shape] = 1;
  } else $GLOBALS['microwp_r36_overflow']=true;
  return $query;
}, PHP_INT_MAX);
register_shutdown_function(function() {
  $path = '/private/microwp-r36-sql-census.jsonl';
  if (!is_dir('/private')) return;
  $size = @filesize($path);
  if ($size !== false && $size > 65536) {
    @file_put_contents($path, "{\"overflow\":true}\n", FILE_APPEND | LOCK_EX);
    return;
  }
  $shapes = $GLOBALS['microwp_r36_shapes'] ?? array();
  ksort($shapes, SORT_STRING);
  $line = json_encode(array(
    'version'=>1, 'total'=>min(2049,(int)($GLOBALS['microwp_r36_total']??0)),
    'overflow'=>!empty($GLOBALS['microwp_r36_overflow']), 'shapes'=>$shapes
  ), JSON_INVALID_UTF8_SUBSTITUTE);
  if (is_string($line) && strlen($line) <= 8192)
    @file_put_contents($path, $line."\n", FILE_APPEND | LOCK_EX);
});`;
