/** Local-only fault-injection Worker. No public endpoints, no external data. */
import {WorkerEntrypoint} from "cloudflare:workers";
import type {CacheCommand,CacheResult} from "../worker-cache/protocol";

export default class LocalUnavailableCacheWorker extends WorkerEntrypoint {
 async execute(_command:CacheCommand):Promise<CacheResult>{
  throw new Error("LOCAL_CACHE_SERVICE_UNAVAILABLE");
 }
 async fetch():Promise<Response>{
  return new Response("Not Found",{status:404,headers:{"Cache-Control":"no-store"}});
 }
}
