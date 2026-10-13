import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
const matrix=JSON.parse(readFileSync(new URL("./gate-acceptance-matrix.json",import.meta.url),"utf8"));
test("Gate B specification traceability must enumerate exactly B-T01..B-T24",()=>{
 assert.deepEqual(matrix.gateB.map(x=>x.id),Array.from({length:24},(_,i)=>"B-T"+String(i+1).padStart(2,"0")));
 for(const entry of matrix.gateB){
   assert.ok(["exampleVerified","partial","notImplemented","criterionVerified"].includes(entry.status));
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

test("B-T13 and B-T21 narrow criterion verifications must have independent proof",()=>{
 const verified=matrix.gateB.filter(x=>x.status==="criterionVerified");
 assert.equal(verified.length,2,"Only B-T13 and B-T21 currently independently substantiated");
 const case13=verified.find(x=>x.id==="B-T13");
 assert.equal(case13.id,"B-T13");
 assert.ok(case13.criterionVerification.primarySourceUrl.startsWith("https://www.nta.go.jp/"));
 assert.equal(case13.criterionVerification.independentExpectedMonthlyYen.smallFree,15360);
 assert.ok(case13.criterionVerification.evidenceTests.includes("tests/officer-housing-tax.test.mjs"));
 assert.ok(case13.criterionVerification.scopeLimit.includes("eligibility"));
 const case21=verified.find(x=>x.id==="B-T21");
 assert.equal(case21.criterionVerification.basis,"approvedGateBAccountingInvariant");
 assert.equal(case21.criterionVerification.independentExpected.zeroIncrementalTaxCF,0);
 assert.equal(case21.criterionVerification.independentExpected.negativeControlChangeAfterTaxCFYen,-1);
 assert.ok(case21.criterionVerification.evidenceTests.includes("tests/gate-b-t21-acceptance.test.mjs"));
 assert.ok(case21.criterionVerification.scopeLimit.includes("legal tax"));
 assert.ok(matrix.gateB.filter(x=>x.status!=="criterionVerified").length>0,"Gate B is not completely accepted");
});
