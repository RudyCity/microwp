<?php
/**
 * Private PHP-WASM side of the microWP D1 v1 protocol.
 *
 * Supply a trusted, in-process $exchange callback implemented by the WASM host.
 * Never accept that callback, raw messages, or returned rows from a public URL.
 * This file does not execute SQL and is not an HTTP endpoint.
 */
declare(strict_types=1);

final class MicroWpD1Client
{
    private const VERSION = 1;
    private const MAX_REQUEST_BYTES = 16384;
    private const MAX_RESPONSE_BYTES = 65536;
    private const MAX_VALUE_BYTES = 2048;
    private const MAX_ROWS = 50;
    private const MAX_OFFSET = 1000;

    /** @var Closure(string): string */
    private Closure $exchange;

    /** @param callable(string): string $exchange Trusted PHP-WASM -> Worker host function */
    public function __construct(callable $exchange)
    {
        $this->exchange = Closure::fromCallable($exchange);
    }

    private static function identifier(string $identifier): string
    {
        if (!preg_match('/^[A-Za-z_][A-Za-z0-9_]{0,63}$/D', $identifier) ||
            preg_match('/^sqlite_/i', $identifier) ||
            in_array($identifier, ['__proto__', 'prototype', 'constructor'], true)) {
            throw new InvalidArgumentException('Invalid D1 identifier');
        }
        return $identifier;
    }

    private static function scalar(mixed $value): string|int|float|null
    {
        if ($value === null) return null;
        if (is_string($value) && strlen($value) <= self::MAX_VALUE_BYTES) return $value;
        if (is_int($value) || (is_float($value) && is_finite($value))) return $value;
        throw new InvalidArgumentException('Invalid D1 scalar');
    }

    /** @param array<string,mixed> $payload */
    private function request(array $payload): array
    {
        $id = bin2hex(random_bytes(12));
        $payload = array_merge(['version' => self::VERSION, 'id' => $id], $payload);
        $json = json_encode($payload, JSON_THROW_ON_ERROR);
        if (strlen($json) > self::MAX_REQUEST_BYTES) {
            throw new InvalidArgumentException('D1 request too large');
        }
        $response = ($this->exchange)($json);
        if (!is_string($response) || strlen($response) > self::MAX_RESPONSE_BYTES) {
            throw new RuntimeException('Invalid D1 response size');
        }
        $decoded = json_decode($response, true, 16, JSON_THROW_ON_ERROR);
        if (!is_array($decoded) || ($decoded['version'] ?? null) !== self::VERSION ||
            ($decoded['id'] ?? null) !== $id || !is_bool($decoded['ok'] ?? null)) {
            throw new RuntimeException('Invalid D1 response');
        }
        if ($decoded['ok'] !== true) {
            // Never reflect arbitrary Worker fields in exception messages.
            throw new RuntimeException('D1 protocol operation rejected');
        }
        if (($decoded['op'] ?? null) !== $payload['op']) {
            throw new RuntimeException('D1 operation mismatch');
        }
        return $decoded;
    }

    /**
     * @param list<string> $columns
     * @param list<array{column: string, value: string|int|float|null}> $where
     * @param array{column: string, direction: 'asc'|'desc'}|null $orderBy
     * @return list<array<string,mixed>>
     */
    public function select(
        string $table, array $columns, array $where = [], int $limit = 25, int $offset = 0,
        ?array $orderBy = null
    ): array {
        self::identifier($table);
        if (count($columns) < 1 || count($columns) > 16) throw new InvalidArgumentException('Invalid columns');
        $columns = array_map(self::identifier(...), $columns);
        if (count($columns) !== count(array_unique($columns))) throw new InvalidArgumentException('Duplicate columns');
        if (count($where) > 8) throw new InvalidArgumentException('Too many predicates');
        $seen = [];
        foreach ($where as &$condition) {
            if (!is_array($condition) || array_keys($condition) !== ['column', 'value']) {
                throw new InvalidArgumentException('Invalid predicate');
            }
            self::identifier($condition['column']);
            if (isset($seen[$condition['column']])) throw new InvalidArgumentException('Duplicate predicate');
            $seen[$condition['column']] = true;
            $condition['value'] = self::scalar($condition['value']);
        }
        unset($condition);
        if ($limit < 1 || $limit > self::MAX_ROWS || $offset < 0 || $offset > self::MAX_OFFSET) {
            throw new InvalidArgumentException('Invalid pagination');
        }
        $payload = ['op' => 'select', 'table' => $table, 'columns' => $columns,
            'where' => $where, 'limit' => $limit, 'offset' => $offset];
        if ($orderBy !== null) {
            self::identifier($orderBy['column']);
            if (!in_array($orderBy['direction'] ?? null, ['asc', 'desc'], true)) {
                throw new InvalidArgumentException('Invalid order');
            }
            $payload['orderBy'] = $orderBy;
        }
        $result = $this->request($payload);
        if (!isset($result['rows']) || !is_array($result['rows'])) {
            throw new RuntimeException('Invalid D1 rows');
        }
        return $result['rows'];
    }

    /** @param array<string,string|int|float|null> $values */
    public function insert(string $table, array $values): int
    {
        self::identifier($table);
        if (count($values) < 1 || count($values) > 16) throw new InvalidArgumentException('Invalid values');
        foreach ($values as $name => $value) {
            self::identifier($name);
            $values[$name] = self::scalar($value);
        }
        $result = $this->request(['op' => 'insert', 'table' => $table, 'values' => $values]);
        return is_int($result['changes'] ?? null) ? $result['changes'] : 0;
    }
}
