/**
 * Versioned private PHP-WASM <-> Worker D1 wire format.
 * Deliberately accepts structured SELECT/INSERT requests, never SQL text.
 * No handler is attached to a Fetch route by this module.
 */
export const D1_PROTOCOL_VERSION = 1 as const;
export const MAX_REQUEST_BYTES = 16 * 1024;
export const MAX_RESPONSE_BYTES = 64 * 1024;
export const MAX_VALUE_BYTES = 2048;
export const MAX_COLUMNS = 16;
export const MAX_PREDICATES = 8;
export const MAX_BINDINGS = 20;
export const MAX_ROWS = 50;
export const MAX_OFFSET = 1000;

export type SqlValue = string | number | null;
export type D1ErrorCode =
  | "BAD_REQUEST"
  | "UNSUPPORTED_VERSION"
  | "NOT_ALLOWED"
  | "RESULT_TOO_LARGE"
  | "EXECUTION_FAILED";

export interface TablePolicy {
  /** Selectable columns; an empty/absent list disables SELECT. */
  readonly select?: readonly string[];
  /** Writable columns; an empty/absent list disables INSERT. */
  readonly insert?: readonly string[];
  /** Columns allowed in equality predicates. */
  readonly filter?: readonly string[];
  /** Columns allowed in ORDER BY. */
  readonly order?: readonly string[];
  /** Server-owned mandatory equality predicate (and INSERT value). Never sourced from PHP. */
  readonly scope?: { readonly column: string; readonly value: SqlValue };
}
export interface D1ProtocolPolicy {
  readonly tables: Readonly<Record<string, TablePolicy>>;
}
export interface Equality {
  column: string;
  value: SqlValue;
}
export interface SelectRequest {
  version: 1;
  id: string;
  op: "select";
  table: string;
  columns: string[];
  where?: Equality[];
  orderBy?: { column: string; direction: "asc" | "desc" };
  limit?: number;
  offset?: number;
}
export interface InsertRequest {
  version: 1;
  id: string;
  op: "insert";
  table: string;
  values: Record<string, SqlValue>;
}
export type D1ProtocolRequest = SelectRequest | InsertRequest;

export class D1ProtocolError extends Error {
  constructor(readonly code: D1ErrorCode) {
    super(code);
    this.name = "D1ProtocolError";
  }
}
const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
const encoder = new TextEncoder();

export function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value)
    && !/^sqlite_/i.test(value) && value !== "__proto__"
    && value !== "prototype" && value !== "constructor";
}
export function checkValue(value: unknown): SqlValue {
  if (value === null) return null;
  if (typeof value === "string" && encoder.encode(value).byteLength <= MAX_VALUE_BYTES) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new D1ProtocolError("BAD_REQUEST");
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, required: readonly string[], allowed: readonly string[]): void {
  for (const key of required) if (!Object.hasOwn(value, key)) throw new D1ProtocolError("BAD_REQUEST");
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new D1ProtocolError("BAD_REQUEST");
}
function identifier(value: unknown): string {
  if (!validIdentifier(value)) throw new D1ProtocolError("BAD_REQUEST");
  return value;
}
function boundedInteger(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new D1ProtocolError("BAD_REQUEST");
  }
  return value as number;
}
function predicates(value: unknown): Equality[] {
  if (!Array.isArray(value) || value.length > MAX_PREDICATES) throw new D1ProtocolError("BAD_REQUEST");
  const seen = new Set<string>();
  return value.map((entry: unknown) => {
    if (!record(entry)) throw new D1ProtocolError("BAD_REQUEST");
    keys(entry, ["column", "value"], ["column", "value"]);
    const column = identifier(entry.column);
    if (seen.has(column)) throw new D1ProtocolError("BAD_REQUEST");
    seen.add(column);
    return { column, value: checkValue(entry.value) };
  });
}

/** Strict wire decoder; malformed inputs cannot reach prepare() or any D1 method. */
export function decodeD1Request(message: string): D1ProtocolRequest {
  if (typeof message !== "string" || encoder.encode(message).byteLength > MAX_REQUEST_BYTES) {
    throw new D1ProtocolError("BAD_REQUEST");
  }
  let payload: unknown;
  try { payload = JSON.parse(message); } catch { throw new D1ProtocolError("BAD_REQUEST"); }
  if (!record(payload)) throw new D1ProtocolError("BAD_REQUEST");
  if (payload.version !== D1_PROTOCOL_VERSION) throw new D1ProtocolError("UNSUPPORTED_VERSION");
  if (typeof payload.id !== "string" || !idPattern.test(payload.id)) throw new D1ProtocolError("BAD_REQUEST");
  if (payload.op === "select") {
    keys(payload, ["version", "id", "op", "table", "columns"],
      ["version", "id", "op", "table", "columns", "where", "orderBy", "limit", "offset"]);
    const table = identifier(payload.table);
    if (!Array.isArray(payload.columns) || payload.columns.length < 1 ||
      payload.columns.length > MAX_COLUMNS) throw new D1ProtocolError("BAD_REQUEST");
    const columns = payload.columns.map(identifier);
    if (new Set(columns).size !== columns.length) throw new D1ProtocolError("BAD_REQUEST");
    const where = payload.where === undefined ? undefined : predicates(payload.where);
    let orderBy: SelectRequest["orderBy"];
    if (payload.orderBy !== undefined) {
      if (!record(payload.orderBy)) throw new D1ProtocolError("BAD_REQUEST");
      keys(payload.orderBy, ["column", "direction"], ["column", "direction"]);
      if (payload.orderBy.direction !== "asc" && payload.orderBy.direction !== "desc") {
        throw new D1ProtocolError("BAD_REQUEST");
      }
      orderBy = { column: identifier(payload.orderBy.column), direction: payload.orderBy.direction };
    }
    const limit = payload.limit === undefined ? 25 : boundedInteger(payload.limit, 1, MAX_ROWS);
    const offset = payload.offset === undefined ? 0 : boundedInteger(payload.offset, 0, MAX_OFFSET);
    return { version: 1, id: payload.id, op: "select", table, columns, where, orderBy, limit, offset };
  }
  if (payload.op === "insert") {
    keys(payload, ["version", "id", "op", "table", "values"],
      ["version", "id", "op", "table", "values"]);
    const table = identifier(payload.table);
    if (!record(payload.values)) throw new D1ProtocolError("BAD_REQUEST");
    const names = Object.keys(payload.values);
    if (names.length < 1 || names.length > MAX_COLUMNS) throw new D1ProtocolError("BAD_REQUEST");
    const values: Record<string, SqlValue> = Object.create(null);
    for (const name of names) values[identifier(name)] = checkValue(payload.values[name]);
    return { version: 1, id: payload.id, op: "insert", table, values };
  }
  throw new D1ProtocolError("BAD_REQUEST");
}
