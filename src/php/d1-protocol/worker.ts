import {
  MAX_BINDINGS, MAX_RESPONSE_BYTES, type D1ProtocolPolicy, type D1ProtocolRequest,
  type SqlValue, D1ProtocolError, decodeD1Request, validIdentifier
} from "./protocol";

/** Dependency-injected, *private* handler. Intentionally not a Fetch/HTTP route. */
export type D1ProtocolDb = Pick<D1Database, "prepare">;

function deny(): never { throw new D1ProtocolError("NOT_ALLOWED"); }
function quote(name: string): string {
  if (!validIdentifier(name)) return deny();
  return '"' + name + '"';
}
function allowed(column: string, permitted: readonly string[] | undefined): void {
  if (!permitted?.includes(column)) deny();
}
function policyFor(policy: D1ProtocolPolicy, table: string) {
  if (!policy || !policy.tables || !Object.hasOwn(policy.tables, table)) return deny();
  const entry = policy.tables[table];
  if (!entry || typeof entry !== "object") return deny();
  const scope = entry.scope;
  if (scope) {
    if (!validIdentifier(scope.column) || scope.value === null ||
      (typeof scope.value !== "string" && typeof scope.value !== "number") ||
      (typeof scope.value === "number" && !Number.isFinite(scope.value))) return deny();
    // Configuration is trusted but must still comply with protocol wire bounds.
    if (typeof scope.value === "string" && new TextEncoder().encode(scope.value).byteLength > 2048) return deny();
  }
  return entry;
}
function response(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > MAX_RESPONSE_BYTES) {
    throw new D1ProtocolError("RESULT_TOO_LARGE");
  }
  return serialized;
}
function ensureBindings(bindings: SqlValue[]) {
  if (bindings.length > MAX_BINDINGS) deny();
}

async function execute(request: D1ProtocolRequest, db: D1ProtocolDb, policy: D1ProtocolPolicy) {
  const permission = policyFor(policy, request.table);
  if (request.op === "select") {
    for (const col of request.columns) allowed(col, permission.select);
    const where: string[] = [];
    const bindings: SqlValue[] = [];
    for (const pred of request.where ?? []) {
      allowed(pred.column, permission.filter);
      if (permission.scope?.column === pred.column) deny();
      if (pred.value === null) {
        where.push(quote(pred.column) + " IS NULL");
      } else {
        where.push(quote(pred.column) + " = ?");
        bindings.push(pred.value);
      }
    }
    if (permission.scope) {
      where.push(quote(permission.scope.column) + " = ?");
      bindings.push(permission.scope.value);
    }
    let sql = "SELECT " + request.columns.map(quote).join(", ") + " FROM " + quote(request.table);
    if (where.length) sql += " WHERE " + where.join(" AND ");
    if (request.orderBy) {
      allowed(request.orderBy.column, permission.order);
      sql += " ORDER BY " + quote(request.orderBy.column) +
        (request.orderBy.direction === "asc" ? " ASC" : " DESC");
    }
    sql += " LIMIT ? OFFSET ?";
    bindings.push(request.limit ?? 25, request.offset ?? 0);
    ensureBindings(bindings);
    const result = await db.prepare(sql).bind(...bindings).all<Record<string, unknown>>();
    if (!result.success || !Array.isArray(result.results) || result.results.length > (request.limit ?? 25)) {
      throw new D1ProtocolError("EXECUTION_FAILED");
    }
    return { version: 1, id: request.id, ok: true, op: "select", rows: result.results };
  }

  const names = Object.keys(request.values);
  for (const name of names) allowed(name, permission.insert);
  const values: SqlValue[] = names.map((name) => request.values[name]);
  if (permission.scope) {
    if (names.includes(permission.scope.column)) deny();
    names.push(permission.scope.column);
    values.push(permission.scope.value);
  }
  ensureBindings(values);
  const sql = "INSERT INTO " + quote(request.table) + " (" + names.map(quote).join(", ") +
    ") VALUES (" + names.map(() => "?").join(", ") + ")";
  const result = await db.prepare(sql).bind(...values).run();
  if (!result.success) throw new D1ProtocolError("EXECUTION_FAILED");
  const changes = result.meta?.changes;
  return { version: 1, id: request.id, ok: true, op: "insert",
    changes: Number.isSafeInteger(changes) && changes >= 0 ? changes : null };
}

/**
 * Only call from an authenticated in-process PHP/WASM host callback.
 * Do not export this to any public route; authentication must be enforced at integration.
 * Errors intentionally omit SQL, arguments, schema, and D1 exception strings.
 */
export async function handleD1ProtocolMessage(
  message: string, db: D1ProtocolDb, policy: D1ProtocolPolicy
): Promise<string> {
  let id = "";
  try {
    const request = decodeD1Request(message);
    id = request.id;
    return response(await execute(request, db, policy));
  } catch (error) {
    const code = error instanceof D1ProtocolError ? error.code : "EXECUTION_FAILED";
    return JSON.stringify({ version: 1, id, ok: false, error: code });
  }
}
