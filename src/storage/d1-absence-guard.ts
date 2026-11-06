/**
 * Durable Object storage marker to distinguish a genuinely new WordPress
 * installation from a previously provisioned site whose D1 manifest vanished.
 *
 * This marker is independent of D1. It never contains WordPress secrets,
 * database bytes or user data. Mark before the first D1 snapshot commit:
 * an interrupted write may require manual recovery, but must never silently
 * create a new empty WordPress installation after a persistence failure.
 */
export const D1_SNAPSHOT_EXPECTED_KEY="microwp:private:d1-snapshot-expected:v1";
export interface D1PresenceStore{
 get(key:string):Promise<unknown>;
 put(key:string,value:boolean):Promise<void>;
}
export class D1SnapshotMissingError extends Error{
 constructor(){
  super("Previously provisioned WordPress D1 snapshot is missing or its independent recovery marker is invalid");
  this.name="D1SnapshotMissingError";
 }
}
/** Returns true if this site was previously provisioned. */
export async function verifyExpectedD1Snapshot(
 store:Pick<D1PresenceStore,"get">,
 snapshot:Uint8Array|null
):Promise<boolean>{
 const marker=await store.get(D1_SNAPSHOT_EXPECTED_KEY);
 if(marker!==null&&marker!==undefined&&marker!==true)
  throw new D1SnapshotMissingError();
 if(marker===true && snapshot===null)
  throw new D1SnapshotMissingError();
 return marker===true;
}
/**
 * Persist the independent recovery marker before relying on a D1 snapshot.
 * Marking is idempotent; callers should avoid rewriting it per request.
 */
export async function armD1SnapshotRecovery(store:D1PresenceStore):Promise<void>{
 await store.put(D1_SNAPSHOT_EXPECTED_KEY,true);
}
