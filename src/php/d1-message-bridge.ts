/**
 * Fixed, private, read-only PHP -> JS -> D1 proof of concept.
 * Intentionally not an SQL execution endpoint or a WordPress wpdb drop-in.
 * No PHP-controlled query text, table identifier, or parameters reach D1.
 */
export const D1_BRIDGE_READINESS_MESSAGE="microwp:d1:readiness:v1";

export interface D1BridgeReadinessResult {ready:boolean}
export async function handleD1BridgeReadinessMessage(message:string,db:Pick<D1Database,"prepare">):Promise<string>{
 if(message!==D1_BRIDGE_READINESS_MESSAGE)return "";
 const result=await db.prepare("SELECT 1 AS ready").first<{ready:number}>();
 return JSON.stringify({ready:result?.ready===1} satisfies D1BridgeReadinessResult);
}
