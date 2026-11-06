import {describe,expect,test} from "bun:test";
import {
 D1_SNAPSHOT_EXPECTED_KEY,D1SnapshotMissingError,
 armD1SnapshotRecovery,verifyExpectedD1Snapshot
} from "../src/storage/d1-absence-guard";

function store(){
 const values=new Map<string,unknown>();
 const instance={
  async get(key:string){return values.get(key)},
  async put(key:string,value:boolean){values.set(key,value)}
 };
 return {values,instance};
}
const snapshot=new Uint8Array([83,81,76,105,116,101,32,102]);
describe("WordPress D1 independent provisioned-site recovery marker",()=>{
 test("brand-new site with no D1 data or marker may begin installation",async()=>{
  const f=store();
  expect(await verifyExpectedD1Snapshot(f.instance,null)).toBe(false);
  expect(f.values.size).toBe(0);
 });
 test("first successful D1 restoration marks an older site's recovery expectation",async()=>{
  const f=store();
  expect(await verifyExpectedD1Snapshot(f.instance,snapshot)).toBe(false);
  await armD1SnapshotRecovery(f.instance);
  expect(await verifyExpectedD1Snapshot(f.instance,snapshot)).toBe(true);
  expect(f.values.get(D1_SNAPSHOT_EXPECTED_KEY)).toBe(true);
 });
 test("missing D1 manifest cannot silently create an empty WordPress site",async()=>{
  const f=store();
  await armD1SnapshotRecovery(f.instance);
  await expect(verifyExpectedD1Snapshot(f.instance,null))
   .rejects.toBeInstanceOf(D1SnapshotMissingError);
 });
 test("invalid/tampered marker fails closed rather than resetting WordPress",async()=>{
  for(const bad of [false,0,"false",{},[]]){
   const f=store();
   f.values.set(D1_SNAPSHOT_EXPECTED_KEY,bad);
   await expect(verifyExpectedD1Snapshot(f.instance,null))
    .rejects.toBeInstanceOf(D1SnapshotMissingError);
   await expect(verifyExpectedD1Snapshot(f.instance,snapshot))
    .rejects.toBeInstanceOf(D1SnapshotMissingError);
  }
 });
 test("marker is armed before, not after, a potentially interrupted D1 write",async()=>{
  const f=store(), events:string[]=[];
  const write=async()=>{
   events.push("write-marker");
   await armD1SnapshotRecovery(f.instance);
   events.push("write-D1");
   throw Error("D1 write interrupted");
  };
  await expect(write()).rejects.toThrow("interrupted");
  expect(await f.instance.get(D1_SNAPSHOT_EXPECTED_KEY)).toBe(true);
  expect(events).toEqual(["write-marker","write-D1"]);
  await expect(verifyExpectedD1Snapshot(f.instance,null)).rejects.toThrow();
 });
});
