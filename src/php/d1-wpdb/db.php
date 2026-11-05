<?php
/**
 * microWP Stage-3 experimental db.php drop-in (READ-ONLY).
 *
 * Not installed by the build. Requires an explicit trusted host wiring and
 * MICRO_WP_D1_READONLY_PROOF === true, set by server-owned bootstrap code.
 * This does NOT implement general WordPress wpdb or WordPress installation.
 * No SQL text is sent over the bridge.
 */
declare(strict_types=1);

if (!defined('MICRO_WP_D1_READONLY_PROOF') || MICRO_WP_D1_READONLY_PROOF !== true) {
    return;
}

if (!class_exists('wpdb', false) || !function_exists('post_message_to_js')) {
    throw new RuntimeException('microWP D1 proof unavailable');
}

if (!class_exists('MicroWpD1ReadOnlyWpdb', false)) {
    final class MicroWpD1ReadOnlyWpdb extends wpdb
    {
        private const MAX_WIRE = 16384;
        private const MAX_REPLY = 65536;
        private const MAX_LIMIT = 50;
        private const IDENT = '[A-Za-z_][A-Za-z0-9_]{0,63}';


        /**
         * Intentionally bypass wpdb's MySQL connection constructor. This is
         * only a method-contract probe, not a compatible wpdb replacement.
         */
        public function __construct()
        {
            $this->last_result = [];
            $this->num_rows = 0;
            $this->rows_affected = 0;
            $this->last_error = '';
        }

        private static function fail(): never
        {
            throw new RuntimeException('Unsupported microWP D1 read-only query');
        }

        /**
         * Parse ONLY literal SELECT column-list FROM table [WHERE col = literal]
         * [LIMIT 1..50]. No joins, expression, star, OR, SQL comments, or
         * multi-statements. String literals may escape quotes as doubled ''.
         * The host independently validates the resulting structured envelope.
         */
        public static function selectEnvelope(string $sql): array
        {
            if (strlen($sql) > self::MAX_WIRE || str_contains($sql, "\0")) self::fail();
            $ident = self::IDENT;
            $pattern = '/\ASELECT\s+(' . $ident . '(?:\s*,\s*' . $ident . '){0,15})\s+FROM\s+(' . $ident . ')' .
                '(?:\s+WHERE\s+(' . $ident . ')\s*=\s*(\d+|\x27(?:[^\x27]|\x27\x27){0,2048}\x27))?' .
                '(?:\s+LIMIT\s+(\d{1,2}))?\s*\z/iD';
            if (!preg_match($pattern, $sql, $m)) self::fail();
            $columns = preg_split('/\s*,\s*/', $m[1]);
            if (!is_array($columns) || count($columns) > 16 || count(array_unique($columns)) !== count($columns)) self::fail();
            foreach (array_merge($columns, [$m[2], $m[3] ?? '']) as $name) {
                if ($name === '') continue;
                if (in_array(strtolower($name), ['constructor', 'prototype', '__proto__'], true) ||
                    str_starts_with(strtolower($name), 'sqlite_')) self::fail();
            }
            $limit = isset($m[5]) && $m[5] !== '' ? (int) $m[5] : 25;
            if ($limit < 1 || $limit > self::MAX_LIMIT) self::fail();
            $where = [];
            if (isset($m[3]) && $m[3] !== '') {
                $literal = $m[4];
                if ($literal[0] === "'") {
                    $value = str_replace("''", "'", substr($literal, 1, -1));
                    if (strlen($value) > 2048) self::fail();
                } else {
                    if (strlen($literal) > 15) self::fail();
                    $value = (int) $literal;
                }
                $where[] = ['column' => $m[3], 'value' => $value];
            }
            return ['op' => 'select', 'table' => $m[2], 'columns' => $columns,
                'where' => $where, 'limit' => $limit, 'offset' => 0];
        }

        /**
         * WordPress wpdb::query() subset. Failures throw: never return fake
         * success or silently fall back to an SQLite/MySQL database.
         */
        public function query($query)
        {
            if (!is_string($query)) self::fail();
            $this->last_result = [];
            $this->num_rows = 0;
            $this->rows_affected = 0;
            $this->last_error = '';
            $this->last_query = $query;
            $payload = self::selectEnvelope($query);
            $payload = ['version' => 1, 'id' => bin2hex(random_bytes(12))] + $payload;
            $json = json_encode($payload, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE);
            if (!is_string($json) || strlen($json) > self::MAX_WIRE) self::fail();
            try {
                $reply = post_message_to_js($json);
                if (!is_string($reply) || strlen($reply) > self::MAX_REPLY) self::fail();
                $parsed = json_decode($reply, true, 32, JSON_THROW_ON_ERROR);
                if (!is_array($parsed) || ($parsed['version'] ?? null) !== 1 ||
                    ($parsed['id'] ?? null) !== $payload['id'] ||
                    ($parsed['ok'] ?? null) !== true || ($parsed['op'] ?? null) !== 'select' ||
                    !isset($parsed['rows']) || !is_array($parsed['rows']) ||
                    count($parsed['rows']) > $payload['limit'] || !array_is_list($parsed['rows'])) self::fail();
                $objects = [];
                foreach ($parsed['rows'] as $row) {
                    if (!is_array($row) || count($row) > 16) self::fail();
                    foreach ($row as $column => $value) {
                        if (!in_array($column, $payload['columns'], true) ||
                            (!is_string($value) && !is_int($value) && !is_float($value) && $value !== null)) self::fail();
                        if (is_string($value) && strlen($value) > 2048) self::fail();
                    }
                    $objects[] = (object) $row;
                }
                $this->last_result = $objects;
                $this->num_rows = count($objects);
                return $this->num_rows;
            } catch (Throwable $error) {
                $this->last_result = [];
                $this->num_rows = 0;
                $this->last_error = 'D1 read-only query refused';
                throw new RuntimeException('microWP private D1 query failed');
            }
        }
    }
}

/**
 * wpdb is initialized only when opt-in is explicitly true. This replaces the
 * global in the normal db.php drop-in convention; do not use on a live WP site.
 */
$GLOBALS['wpdb'] = new MicroWpD1ReadOnlyWpdb();
