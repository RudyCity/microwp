import { describe, expect, test } from "bun:test";
import { createD1RuntimeAdapter } from "../src/php/d1-protocol/runtime-adapter";
import type { D1ProtocolPolicy } from "../src/php/d1-protocol/protocol";

const wire = (value: object) => JSON.stringify({ version: 1, id: "host1", ...value });
const select = () => wire({ op: "select", table: "posts", columns: ["id"], limit: 2 });
function setup() {
  const key = Object.freeze({});
  let calls = 0;
  const statements: Array<{ sql: string; bindings: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      calls++;
      return {
        bind(...bindings: unknown[]) {
          statements.push({ sql, bindings });
          return {
            async all() { return { success: true, results: [{ id: 7 }] }; },
            async run() { return { success: true, meta: { changes: 1 } }; }
          };
        }
      };
    }
  } as unknown as D1Database;
  const policy: D1ProtocolPolicy = {
    tables: { posts: { select: ["id"], insert: ["title"], filter: ["id"], scope: { column: "site_id", value: "tenant-A" } } }
  };
  return { key, db, policy, statements, calls: () => calls };
}
describe("D1 private runtime adapter prototype", () => {
  test("allows authenticated in-process SELECT and preserves server-owned tenant scope", async () => {
    const f = setup();
    const adapter = createD1RuntimeAdapter({ db: f.db, policy: f.policy, callerKey: f.key });
    expect(JSON.parse(await adapter.dispatch(select(), f.key))).toEqual({
      version: 1, id: "host1", ok: true, op: "select", rows: [{ id: 7 }]
    });
    expect(f.statements).toEqual([{
      sql: 'SELECT "id" FROM "posts" WHERE "site_id" = ? LIMIT ? OFFSET ?',
      bindings: ["tenant-A", 2, 0]
    }]);
  });

  test("unauthorized keys and missing key always deny before decode/SQL", async () => {
    const f = setup();
    const adapter = createD1RuntimeAdapter({ db: f.db, policy: f.policy, callerKey: f.key });
    for (const key of [undefined, null, {}, Object.freeze({}), "tenant-A", 1]) {
      expect(JSON.parse(await adapter.dispatch(select(), key))).toEqual({
        version: 1, id: "", ok: false, error: "NOT_ALLOWED"
      });
    }
    expect(f.calls()).toBe(0);
  });

  test("snapshot policy prevents mutation, tenant scope substitution, and expanded permissions", async () => {
    const f = setup();
    const adapter = createD1RuntimeAdapter({ db: f.db, policy: f.policy, callerKey: f.key });
    (f.policy.tables as Record<string, any>).posts = {
      select: ["id", "secret"], insert: ["secret"], scope: { column: "site_id", value: "tenant-B" }
    };
    const denied = wire({ op: "select", table: "posts", columns: ["secret"] });
    expect(JSON.parse(await adapter.dispatch(denied, f.key)).error).toBe("NOT_ALLOWED");
    expect(JSON.parse(await adapter.dispatch(wire({
      op: "select", table: "posts", columns: ["id"], where: [{ column: "site_id", value: "tenant-B" }]
    }), f.key)).error).toBe("NOT_ALLOWED");
    await adapter.dispatch(select(), f.key);
    expect(f.statements[0].bindings[0]).toBe("tenant-A");
  });

  test("denies unlisted tables, operations and raw SQL before D1", async () => {
    const f = setup();
    const adapter = createD1RuntimeAdapter({ db: f.db, policy: f.policy, callerKey: f.key });
    for (const input of [
      wire({ op: "select", table: "users", columns: ["id"] }),
      wire({ op: "delete", table: "posts", where: [] }),
      wire({ op: "select", table: "posts", columns: ["id"], sql: "DROP TABLE posts" }),
      wire({ op: "insert", table: "posts", values: { site_id: "tenant-B", title: "x" } })
    ]) {
      expect(JSON.parse(await adapter.dispatch(input, f.key)).ok).toBe(false);
    }
    expect(f.calls()).toBe(0);
  });

  test("rejects malformed, unsupported, oversized and non-string inputs without D1 calls", async () => {
    const f = setup();
    const adapter = createD1RuntimeAdapter({ db: f.db, policy: f.policy, callerKey: f.key });
    for (const input of [null, 1, {}, [], "", "{", "x".repeat(16385),
      wire({ op: "select", table: "posts", columns: ["id"], limit: 51 }),
      JSON.stringify({ version: 2, id: "host1", op: "select", table: "posts", columns: ["id"] })
    ]) {
      expect(JSON.parse(await adapter.dispatch(input, f.key)).ok).toBe(false);
    }
    expect(f.calls()).toBe(0);
  });

  test("fails closed for invalid policy, missing scope, invalid dependencies", () => {
    const f = setup();
    for (const policy of [
      { tables: {} }, { tables: { posts: { select: ["id"] } } },
      { tables: { posts: { select: ["id"], scope: { column: "site_id", value: null } } } },
      { tables: { posts: { select: ["id", "id"], scope: { column: "site_id", value: "a" } } } },
      { tables: { posts: { select: ["site_id"], scope: { column: "site_id", value: "a" } } } }
    ]) expect(() => createD1RuntimeAdapter({ db: f.db, policy: policy as D1ProtocolPolicy, callerKey: f.key })).toThrow();
    expect(() => createD1RuntimeAdapter({ db: f.db, policy: f.policy, callerKey: null as unknown as object })).toThrow();
    expect(f.calls()).toBe(0);
  });

  test("D1 errors remain sanitized without SQL or secrets", async () => {
    const f = setup();
    const failDb = { prepare() { throw Error("secret SQL and credentials"); } } as unknown as D1Database;
    const adapter = createD1RuntimeAdapter({ db: failDb, policy: f.policy, callerKey: f.key });
    const result = await adapter.dispatch(select(), f.key);
    expect(JSON.parse(result)).toEqual({ version: 1, id: "host1", ok: false, error: "EXECUTION_FAILED" });
    expect(result).not.toContain("secret");
  });

  test("no exported HTTP handler, fetch route, or global registration", () => {
    const f = setup();
    const adapter = createD1RuntimeAdapter({ db: f.db, policy: f.policy, callerKey: f.key });
    expect(Object.keys(adapter)).toEqual(["dispatch"]);
    expect("fetch" in adapter).toBe(false);
    expect("handleRequest" in adapter).toBe(false);
    expect("route" in adapter).toBe(false);
    expect(Object.isFrozen(adapter)).toBe(true);
  });
});
