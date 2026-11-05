import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  decodeD1Request, handleD1ProtocolMessage, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES,
  type D1ProtocolPolicy
} from "../src/php/d1-protocol";

const policy: D1ProtocolPolicy = {
  tables: {
    posts: {
      select: ["id", "title", "slug"],
      insert: ["slug", "title"],
      filter: ["id", "slug"],
      order: ["id"],
      scope: { column: "site_id", value: "site-A" }
    },
    readonly_posts: { select: ["id"], filter: ["id"] }
  }
};
const request = (op: object) => JSON.stringify({ version: 1, id: "req_01", ...op });
function fixture() {
  const sqlite = new Database(":memory:");
  sqlite.exec("CREATE TABLE posts (id INTEGER PRIMARY KEY, site_id TEXT NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL)");
  sqlite.exec("CREATE TABLE readonly_posts (id INTEGER PRIMARY KEY)");
  sqlite.exec("INSERT INTO posts (site_id, slug, title) VALUES ('site-A', 'a', 'alpha'), ('site-B', 'b', 'beta')");
  let sqlCalls = 0;
  const compiled: { sql: string; args: (string | number | null)[] }[] = [];
  const db = {
    prepare(sql: string) {
      sqlCalls++;
      return {
        bind(...args: (string | number | null)[]) {
          compiled.push({ sql, args });
          return {
            async all() { return { success: true, results: sqlite.prepare(sql).all(...args) }; },
            async run() {
              const result = sqlite.prepare(sql).run(...args);
              return { success: true, meta: { changes: result.changes } };
            }
          };
        }
      };
    }
  } as unknown as D1Database;
  return { sqlite, db, compiled, calls: () => sqlCalls };
}
const call = async (db: D1Database, payload: object | string, currentPolicy = policy) =>
  JSON.parse(await handleD1ProtocolMessage(typeof payload === "string" ? payload : request(payload), db, currentPolicy));

describe("private D1 SQL protocol v1", () => {
  test("SELECT uses bindings and enforces a server-side scope", async () => {
    const f = fixture();
    const res = await call(f.db, {
      op: "select", table: "posts", columns: ["id", "title"],
      where: [{ column: "slug", value: "a" }], orderBy: { column: "id", direction: "asc" },
      limit: 3, offset: 0
    });
    expect(res).toEqual({ version: 1, id: "req_01", ok: true, op: "select", rows: [{ id: 1, title: "alpha" }] });
    expect(f.compiled[0]).toEqual({
      sql: 'SELECT "id", "title" FROM "posts" WHERE "slug" = ? AND "site_id" = ? ORDER BY "id" ASC LIMIT ? OFFSET ?',
      args: ["a", "site-A", 3, 0]
    });
    const other = await call(f.db, { op: "select", table: "posts", columns: ["id"], limit: 50 });
    expect(other.rows).toEqual([{ id: 1 }]);
    f.sqlite.close();
  });

  test("malicious values cannot change a SELECT or execute another statement", async () => {
    const f = fixture();
    const malicious = "a' OR 1=1; DROP TABLE posts; --";
    const res = await call(f.db, {
      op: "select", table: "posts", columns: ["id"], where: [{ column: "slug", value: malicious }]
    });
    expect(res.rows).toEqual([]);
    expect(f.compiled[0].args[0]).toBe(malicious);
    expect((f.sqlite.prepare("SELECT COUNT(*) AS n FROM posts").get() as { n: number }).n).toBe(2);
    f.sqlite.close();
  });

  test("INSERT binds payload values and injects the trusted site ID", async () => {
    const f = fixture();
    const malicious = "x'); DROP TABLE posts; --";
    const result = await call(f.db, {
      op: "insert", table: "posts", values: { slug: "injection", title: malicious }
    });
    expect(result).toEqual({ version: 1, id: "req_01", ok: true, op: "insert", changes: 1 });
    expect(f.compiled[0]).toEqual({
      sql: 'INSERT INTO "posts" ("slug", "title", "site_id") VALUES (?, ?, ?)',
      args: ["injection", malicious, "site-A"]
    });
    expect(f.sqlite.prepare("SELECT site_id, title FROM posts WHERE slug = ?").get("injection"))
      .toEqual({ site_id: "site-A", title: malicious });
    f.sqlite.close();
  });

  test("rejects raw SQL, other operations, extra fields and unsupported versions before D1 access", async () => {
    const f = fixture();
    const inputs = [
      "not json", "[]", "null", "",
      request({ op: "raw", sql: "DROP TABLE posts" }),
      request({ op: "update", table: "posts", values: { title: "x" } }),
      request({ op: "select", table: "posts", columns: ["id"], sql: "DROP TABLE posts" }),
      request({ op: "insert", table: "posts", values: { title: "x" }, returning: "*" }),
      JSON.stringify({ version: 2, id: "req_01", op: "select", table: "posts", columns: ["id"] }),
      request({ op: "select", table: "posts; DROP TABLE posts", columns: ["id"] }),
      request({ op: "select", table: "posts", columns: ["id", "id"] }),
      request({ op: "select", table: "posts", columns: ["id"], where: [{ column: "id", value: 1, extra: true }] })
    ];
    for (const input of inputs) {
      const response = await call(f.db, input);
      expect(response.ok).toBe(false);
      expect(["BAD_REQUEST", "UNSUPPORTED_VERSION"]).toContain(response.error);
    }
    expect(f.calls()).toBe(0);
    f.sqlite.close();
  });

  test("policy denies table, column, filter, order, unapproved operations and scope tampering", async () => {
    const f = fixture();
    const denied = [
      { op: "select", table: "users", columns: ["id"] },
      { op: "select", table: "posts", columns: ["site_id"] },
      { op: "select", table: "posts", columns: ["id"], where: [{ column: "title", value: "x" }] },
      { op: "select", table: "posts", columns: ["id"], orderBy: { column: "slug", direction: "asc" } },
      { op: "select", table: "posts", columns: ["id"], where: [{ column: "site_id", value: "site-B" }] },
      { op: "insert", table: "posts", values: { title: "x", slug: "x", site_id: "site-B" } },
      { op: "insert", table: "readonly_posts", values: { id: 20 } },
      { op: "insert", table: "posts", values: { slug: "x", id: 42 } }
    ];
    for (const value of denied) expect((await call(f.db, value)).error).toBe("NOT_ALLOWED");
    expect(f.calls()).toBe(0);
    f.sqlite.close();
  });

  test("bounded pagination, parameter and message limits deny before D1", async () => {
    const f = fixture();
    for (const limit of [0, -1, 51, 1.5, "2", null, Number.MAX_SAFE_INTEGER]) {
      expect((await call(f.db, { op: "select", table: "posts", columns: ["id"], limit })).error).toBe("BAD_REQUEST");
    }
    expect((await call(f.db, { op: "select", table: "posts", columns: ["id"], offset: 1001 })).error).toBe("BAD_REQUEST");
    expect((await call(f.db, { op: "select", table: "posts", columns: ["id"], where: Array.from({ length: 9 }, (_, i) => ({ column: "c" + i, value: "x" })) })).error).toBe("BAD_REQUEST");
    expect((await call(f.db, { op: "insert", table: "posts", values: { title: "x".repeat(2049) } })).error).toBe("BAD_REQUEST");
    expect((await call(f.db, request({ op: "select", table: "posts", columns: ["id"] }) + " ".repeat(MAX_REQUEST_BYTES))).error).toBe("BAD_REQUEST");
    expect(f.calls()).toBe(0);
    f.sqlite.close();
  });

  test("null predicates compile to IS NULL; results must stay within the response cap", async () => {
    const f = fixture();
    const result = await call(f.db, { op: "select", table: "posts", columns: ["id"], where: [{ column: "slug", value: null }] });
    expect(result.rows).toEqual([]);
    expect(f.compiled[0].sql).toContain('"slug" IS NULL');
    expect(f.compiled[0].args).toEqual(["site-A", 25, 0]);
    const hugeDb = {
      prepare() { return { bind() { return { all: async () => ({ success: true, results: [{ title: "a".repeat(MAX_RESPONSE_BYTES) }] }) }; } }; }
    } as unknown as D1Database;
    const tooLarge = await call(hugeDb, { op: "select", table: "posts", columns: ["title"] });
    expect(tooLarge).toEqual({ version: 1, id: "req_01", ok: false, error: "RESULT_TOO_LARGE" });
    f.sqlite.close();
  });

  test("D1 failure and malformed results never expose exception, SQL or values", async () => {
    const secret = "private D1 exception and secret";
    const failDb = {
      prepare() { return { bind() { return { all: async () => { throw new Error(secret); } }; } }; }
    } as unknown as D1Database;
    const error = await call(failDb, { op: "select", table: "posts", columns: ["id"] });
    expect(error).toEqual({ version: 1, id: "req_01", ok: false, error: "EXECUTION_FAILED" });
    expect(JSON.stringify(error)).not.toContain(secret);
    const malformedDb = {
      prepare() { return { bind() { return { all: async () => ({ success: true, results: Array.from({ length: 51 }, () => ({ id: 1 })) }) }; } }; }
    } as unknown as D1Database;
    expect((await call(malformedDb, { op: "select", table: "posts", columns: ["id"] })).error).toBe("EXECUTION_FAILED");
  });

  test("decoder returns a strict v1 AST and rejects unsafe or oversized identifiers", () => {
    expect(decodeD1Request(request({ op: "select", table: "posts", columns: ["id"] }))).toMatchObject({
      version: 1, id: "req_01", op: "select", table: "posts", columns: ["id"]
    });
    for (const name of ["sqlite_master", "constructor", "__proto__", "a".repeat(65), "wp-posts"]) {
      expect(() => decodeD1Request(request({ op: "select", table: name, columns: ["id"] }))).toThrow();
    }
  });
});
