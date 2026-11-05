/* PHP WASM isolated smoke probes. No untrusted code evaluation. */
import { PHP, loadPHPRuntime } from "@php-wasm/universal";
import * as loader from "./generated/php-loader.js";
import phpWasmModule from "../node_modules/@php-wasm/web-8-4/asyncify/8_4_27/php_8_4.wasm";
let current: Promise<PHP> | undefined;
let queue: Promise<unknown> = Promise.resolve();
const DEMO_PHP = `<?php
header('Content-Type: application/json; charset=utf-8');
echo json_encode([
  'php' => PHP_VERSION,
  'method' => $_SERVER['REQUEST_METHOD'] ?? null,
  'uri' => $_SERVER['REQUEST_URI'] ?? null,
  'query' => $_GET,
  'post' => $_POST,
  'cookie' => $_COOKIE
]);
`;
async function getPHP(): Promise<PHP> {
  if (!current) current = (async () => {
    const runtime = await loadPHPRuntime(loader, {
      instantiateWasm(imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) {
        const instance = new WebAssembly.Instance(phpWasmModule, imports);
        receive(instance, phpWasmModule);
        return instance.exports;
      }
    });
    const php = new PHP(runtime);
    php.mkdir("/www");
    await php.writeFile("/www/index.php",DEMO_PHP);
    return php;
  })().catch(err => {current=undefined;throw err});
  return current;
}
function serialized<T>(action: () => Promise<T>): Promise<T> {
  const result = queue.then(action, action);
  queue = result.then(()=>undefined,()=>undefined);
  return result;
}
export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (!["/__microwp/php-probe","/__microwp/http-probe","/__microwp/extensions-probe"].includes(url.pathname))
      return new Response("Not Found",{status:404});
    if (req.method !== "GET" && req.method !== "POST") return new Response("Method Not Allowed",{status:405});
    const length = Number(req.headers.get("Content-Length") ?? 0);
    if (length > 16384) return new Response("Payload Too Large",{status:413});
    return serialized(async () => {
      try {
        const php = await getPHP();
        if (url.pathname === "/__microwp/php-probe") {
          const result = await php.runStream({code:'<?php echo "microWP PHP ".PHP_VERSION;'});
          return new Response(await result.stdoutText,{headers:{"Content-Type":"text/plain"}});
        }
        if (url.pathname === "/__microwp/extensions-probe") {
          const result = await php.runStream({code:'<?php echo json_encode(["extensions"=>get_loaded_extensions(),"mysqli"=>function_exists("mysqli_connect"),"sqlite"=>class_exists("SQLite3"),"pdo"=>class_exists("PDO"),"pdo_sqlite"=>in_array("sqlite",PDO::getAvailableDrivers())]);'});
          return new Response(await result.stdoutText,{headers:{"Content-Type":"application/json"}});
        }
        const body = req.method === "POST" ? new Uint8Array(await req.arrayBuffer()) : new Uint8Array();
        if (body.byteLength > 16384) return new Response("Payload Too Large",{status:413});
        const headers: Record<string,string> = {};
        for (const key of ["Content-Type","Cookie","User-Agent","Accept","Host"]) {
          const val = req.headers.get(key);
          if (val) headers[key]=val;
        }
        const result = await php.runStream({
          scriptPath: "/www/index.php", relativeUri: url.pathname + url.search,
          protocol: url.protocol.replace(":",""),method: req.method as "GET"|"POST",
          headers,$_SERVER: {SERVER_NAME:url.hostname, SERVER_PORT:url.port || (url.protocol==="https:"?"443":"80")},body
        });
        return new Response(await result.stdoutText,{headers:{"Content-Type":"application/json; charset=utf-8"}});
      } catch (err) {
        return Response.json({error:"PHP_WASM_PROBE_FAILED",message:String(err)}, {status:500});
      }
    });
  }
};
