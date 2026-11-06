import {
  checkValue, decodeD1Request, MAX_COLUMNS, type D1ProtocolPolicy, type SqlValue,
  validIdentifier
} from "./protocol";
import { handleD1ProtocolMessage, type D1ProtocolDb } from "./worker";

/**
 * STAGE-2 PROTOTYPE: private, in-isolate host adapter, NOT a production wpdb
 * adapter or public API. The host MUST retain callerKey privately and never
 * forward requests from fetch, cookies, request bodies, or untrusted plugins.
 * This adapter intentionally does not register a fetch handler or global.
 */
export interface D1RuntimeAdapterOptions {
  readonly db: D1ProtocolDb;
  readonly policy: D1ProtocolPolicy;
  /** Server-created object identity, never exposed to PHP or HTTP clients. */
  readonly callerKey: object;
  /** Separate opaque host-only object identity for each permitted write op. */
  readonly writeCapabilities?: Readonly<{insert?:object;update?:object;delete?:object}>;
}
export interface D1RuntimeAdapter {
  /** Only call from a trusted host callback holding callerKey. */
  dispatch(message: unknown, callerKey: unknown, writeCapability?: unknown): Promise<string>;
}

const denial = (error: "NOT_ALLOWED" | "BAD_REQUEST" | "EXECUTION_FAILED"): string =>
  JSON.stringify({ version: 1, id: "", ok: false, error });

function copiedNames(value: readonly string[] | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_COLUMNS ||
      value.some((name) => !validIdentifier(name)) ||
      new Set(value).size !== value.length) throw new TypeError("Invalid D1 runtime policy");
  return Object.freeze([...value]);
}

/** Snapshot the trusted policy; later mutations cannot widen an active adapter. */
function snapshotPolicy(policy: D1ProtocolPolicy): D1ProtocolPolicy {
  if (!policy || typeof policy !== "object" || !policy.tables ||
      typeof policy.tables !== "object" || Array.isArray(policy.tables)) {
    throw new TypeError("Invalid D1 runtime policy");
  }
  const tables: Record<string, NonNullable<D1ProtocolPolicy["tables"][string]>> = Object.create(null);
  const entries = Object.entries(policy.tables);
  if (entries.length === 0 || entries.length > 32) throw new TypeError("Invalid D1 runtime policy");
  for (const [table, rule] of entries) {
    if (!validIdentifier(table) || !rule || typeof rule !== "object" ||
        Array.isArray(rule)) throw new TypeError("Invalid D1 runtime policy");
    const scope = rule.scope;
    if (!scope || !validIdentifier(scope.column) || scope.value === null) {
      // A host-level adapter always requires tenant scope, including read-only tables.
      throw new TypeError("D1 runtime policy requires a non-null server scope");
    }
    let value: SqlValue;
    try { value = checkValue(scope.value); }
    catch { throw new TypeError("Invalid D1 runtime scope"); }
    const select = copiedNames(rule.select);
    const insert = copiedNames(rule.insert);
    const update = copiedNames(rule.update);
    const filter = copiedNames(rule.filter);
    const order = copiedNames(rule.order);
    const deleteAllowed=rule.delete===true;
    const identityColumn=rule.identityColumn;
    if (rule.delete!==undefined && typeof rule.delete!=="boolean")
      throw new TypeError("Invalid D1 delete policy");
    if(identityColumn!==undefined && !validIdentifier(identityColumn))
      throw new TypeError("Invalid D1 identity column");
    if((update?.length||deleteAllowed)&&
       (!identityColumn||!filter?.includes(identityColumn)||identityColumn===scope.column))
      throw new TypeError("D1 write policy requires a schema-verified scoped unique identity column");
    if ((!select?.length && !insert?.length && !update?.length && !deleteAllowed) ||
        [select, insert, update, filter, order].some((names) => names?.includes(scope.column)) ||
        update?.includes(identityColumn??"")) {
      throw new TypeError("Invalid D1 runtime policy");
    }
    tables[table] = Object.freeze({
      select, insert, update, delete:deleteAllowed, identityColumn,
      filter, order, scope: Object.freeze({ column: scope.column, value })
    });
  }
  return Object.freeze({ tables: Object.freeze(tables) });
}

export function createD1RuntimeAdapter(options: D1RuntimeAdapterOptions): D1RuntimeAdapter {
  if (!options || !options.db || typeof options.db.prepare !== "function" ||
      !options.callerKey || typeof options.callerKey !== "object") {
    throw new TypeError("Invalid trusted D1 runtime dependencies");
  }
  const { db, callerKey } = options;
  const policy = snapshotPolicy(options.policy);
  // Snapshot object identity, never the caller's mutable capability container.
  const grants={
    insert:options.writeCapabilities?.insert,
    update:options.writeCapabilities?.update,
    delete:options.writeCapabilities?.delete
  };
  const granted=Object.values(grants).filter((key)=>key!==undefined);
  if(granted.some(key=>typeof key!=="object"||key===null||key===callerKey)||
     new Set(granted).size!==granted.length)
    throw new TypeError("Invalid independent D1 write capabilities");
  return Object.freeze({
    async dispatch(message: unknown, suppliedKey: unknown, suppliedWriteCapability?: unknown): Promise<string> {
      // Check origin first: even malformed, oversized untrusted inputs never touch D1.
      if (suppliedKey !== callerKey) return denial("NOT_ALLOWED");
      if (typeof message !== "string") return denial("BAD_REQUEST");
      try {
        const request=decodeD1Request(message);
        if(request.op!=="select" && (!grants[request.op]||
          suppliedWriteCapability!==grants[request.op]))return denial("NOT_ALLOWED");
        return await handleD1ProtocolMessage(message, db, policy,
          request.op==="update"||request.op==="delete"?request.op:undefined);
      } catch {
        // The underlying handler already sanitizes D1 failures; keep this
        // defense for unexpected integration-level exceptions.
        return denial("EXECUTION_FAILED");
      }
    }
  });
}
