import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const file = join(import.meta.dir, "../src/php/d1-wpdb/db.php");
const source = readFileSync(file, "utf8");
const php = (script: string) => Bun.spawnSync(["php", "-r", script], { stdout: "pipe", stderr: "pipe" });
const phpAvailable = php("echo 1;").exitCode === 0;
function runner(body: string, optIn = true) {
  const setup = `class wpdb { public array $last_result = []; public int $num_rows = 0; public int $rows_affected = 0; public string $last_error = ''; public string $last_query = ''; }
${optIn ? "define('MICRO_WP_D1_READONLY_PROOF',true);" : ""}
function post_message_to_js($msg) {
 $GLOBALS['messages'][] = json_decode($msg,true);
 $request = json_decode($msg,true);
 return json_encode(['version'=>1,'id'=>$request['id'],'ok'=>true,'op'=>'select','rows'=>[['id'=>7]]]);
}
include ${JSON.stringify(file.replaceAll("\\", "/"))};
${body}`;
  return php(setup);
}
describe("stage3 read-only db.php contract", () => {
  test("new drop-in has no HTTP/public or untrusted SQL forwarding", () => {
    expect(source).toContain("MICRO_WP_D1_READONLY_PROOF");
    expect(source).toContain("post_message_to_js($json)");
    expect(source.includes("fetch(")).toBe(false);
    expect(source).toContain("selectEnvelope");
  });
  test.skipIf(!phpAvailable)("PHP CLI lint", () => {
    const r = php("echo 'up';");
    expect(r.exitCode).toBe(0);
    const check = Bun.spawnSync(["php", "-l", file]);
    expect(check.exitCode).toBe(0);
  });
  test.skipIf(!phpAvailable)("disabled opt-in doesn't replace global wpdb", () => {
    const r = runner("echo isset($GLOBALS['wpdb']) ? 'bad' : 'unchanged';", false);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toBe("unchanged");
  });
  test.skipIf(!phpAvailable)("structured SELECT envelope and bounded row return", () => {
    const r = runner(`$n=$GLOBALS['wpdb']->query("SELECT id FROM wp_posts WHERE id = 7 LIMIT 2");
echo json_encode(['count'=>$n,'rows'=>$GLOBALS['wpdb']->last_result,'wire'=>$GLOBALS['messages'][0]]);`);
    expect(r.exitCode).toBe(0);
    const result = JSON.parse(r.stdout.toString());
    expect(result.count).toBe(1);
    expect(result.rows).toEqual([{ id: 7 }]);
    expect(result.wire).toMatchObject({ version: 1, op: "select", table: "wp_posts",
      columns: ["id"], where: [{ column: "id", value: 7 }], limit: 2, offset: 0 });
    expect(result.wire).not.toHaveProperty("sql");
  });
  test.skipIf(!phpAvailable)("unsupported operations and SQL dialect fail without sending messages", () => {
    const r = runner(`$bad=["DELETE FROM wp_posts","SELECT * FROM wp_posts","SELECT id FROM wp_posts; DROP TABLE x","SELECT id FROM wp_posts WHERE id = 1 OR id = 2","SELECT id FROM wp_posts LIMIT 51","SELECT id FROM wp_posts JOIN users ON 1=1","SELECT id FROM wp_posts -- comment"];
foreach($bad as $query){try{$GLOBALS['wpdb']->query($query);echo 'BAD';}catch(Throwable $e){echo 'DENY ';}}
echo count($GLOBALS['messages'] ?? []);`);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toBe("DENY ".repeat(7) + "0");
  });
  test.skipIf(!phpAvailable)("host reply correlation mismatch fails closed", () => {
    const r = php(`class wpdb { public array $last_result=[]; public int $num_rows=0; public int $rows_affected=0; public string $last_error=''; public string $last_query=''; }
define('MICRO_WP_D1_READONLY_PROOF',true);
function post_message_to_js($m){return json_encode(['version'=>1,'id'=>'wrong','ok'=>true,'op'=>'select','rows'=>[['id'=>9]]]);}
include ${JSON.stringify(file.replaceAll("\\", "/"))};
try{$GLOBALS['wpdb']->query("SELECT id FROM posts LIMIT 1"); echo 'BAD';}
catch(Throwable $e){echo json_encode(['count'=>$GLOBALS['wpdb']->num_rows,'rows'=>$GLOBALS['wpdb']->last_result,'message'=>$e->getMessage()]);}`);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout.toString())).toEqual({ count: 0, rows: [], message: "microWP private D1 query failed" });
  });
});
