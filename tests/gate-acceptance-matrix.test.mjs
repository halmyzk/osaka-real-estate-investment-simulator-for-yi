import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
const matrix=JSON.parse(readFileSync(new URL("./gate-acceptance-matrix.json",import.meta.url),"utf8"));
test("Gate B specification traceability must enumerate exactly B-T01..B-T24",()=>{
 assert.deepEqual(matrix.gateB.map(x=>x.id),Array.from({length:24},(_,i)=>"B-T"+String(i+1).padStart(2,"0")));
 for(const entry of matrix.gateB){
   assert.ok(["exampleVerified","partial","notImplemented"].includes(entry.status));
   assert.ok(entry.gap?.length>5);
   assert.ok(entry.evidence.length>0);
 }
});
test("Gate A and B evidence paths must reference actual test modules",()=>{
 for(const entry of [...matrix.gateA,...matrix.gateB]){
  for(const path of entry.evidence)assert.ok(existsSync(new URL("../"+path,import.meta.url)),entry.id+" missing "+path);
 }
});
test("Gate B not falsely marked fully accepted while gaps remain",()=>{
 assert.ok(matrix.gateB.some(x=>x.status==="partial"));
 assert.ok(matrix.gateB.every(x=>x.status!=="complete"),"Do not silently certify a full Gate B acceptance");
});
