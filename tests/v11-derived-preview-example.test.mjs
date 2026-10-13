import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fingerprintV11Document} from "../src/v11-income-tax-sidecar.mjs";
import {inspectV11Draft} from "../src/v11-draft-storage.mjs";
import {previewV11Scenario} from "../src/v11-preview-engine.mjs";
const load=name=>JSON.parse(readFileSync(new URL("../preview/"+name,import.meta.url),"utf8"));
const doc=load("v11-ordinary-income-sample.json");
const plan=load("v11-derived-tax-plan-example.json");
const near=(x,y)=>assert.ok(Math.abs(x-y)<.000001,x+" != "+y);
test("Developer-owned M4 tax demo is valid saved document and its tax plan exactly fingerprint matches",()=>{
 const report=inspectV11Draft(doc);
 assert.equal(report.status,"structurallyReviewed");
 assert.equal(report.unitCount,2);
 assert.equal(report.entityCount,2);
 assert.equal(plan.documentFingerprint,fingerprintV11Document(doc));
 assert.equal(plan.taxScope,"ordinaryIncomeOnly");
 assert.equal(plan.vatTreatment,"notConnected");
 assert.equal(plan.withholdingTreatment,"notModeled");
});
test("Committed derivative tax demo computes reviewed income taxes from persisted monthly rents, not a typed tax total",()=>{
 const result=previewV11Scenario(doc,{scenarioId:"base",derivedTaxPlan:plan});
 assert.equal(result.status,"estimated-pre-tax");
 assert.equal(result.incomeTaxStatus,"estimated",result.incomeTaxBlocker??"");
 assert.equal(result.incomeTaxCalculationBasis,"derivedFromUnitOperations");
 assert.equal(result.derivedTaxUnitYearProof.length,2);
 const personal=result.derivedTaxUnitYearProof.find(x=>x.entityId==="person-1");
 const corporate=result.derivedTaxUnitYearProof.find(x=>x.entityId==="corporation-1");
 assert.equal(personal.rentalRevenue,1620000);
 assert.equal(corporate.rentalRevenue,1080000);
 assert.equal(personal.reviewedOperatingExpense,612000);
 assert.equal(corporate.reviewedOperatingExpense,612000);
 near(result.incomeTaxCashEvents.reduce((s,x)=>s+x.incrementalTaxCF,0),-297316.8);
 assert.deepEqual(result.annualIncomeTaxSensitivity.map(x=>x.year),[2026,2027,2028]);
 assert.equal(result.afterTax,null,"VAT/income-tax qualification still pending");
 assert.equal(result.taxStatus,"incomplete");
});
test("Financial change or Upside override forces re-review of year-specific tax inputs",()=>{
 const high=previewV11Scenario(doc,{scenarioId:"upside",derivedTaxPlan:plan});
 assert.equal(high.incomeTaxStatus,"incomplete");
 assert.equal(high.afterIncomeTaxSensitivity,null);
 const changed=structuredClone(doc);
 changed.units[0].fields.R.R01.value=90000;
 const result=previewV11Scenario(changed,{derivedTaxPlan:plan});
 assert.equal(result.incomeTaxStatus,"incomplete");
 assert.match(result.incomeTaxBlocker,/fingerprint/);
});
test("Developer UI visibly offers separately named automatic tax scenario and cannot silently claim full after-tax indicators",()=>{
 const html=readFileSync(new URL("../preview/v11-dev.html",import.meta.url),"utf8");
 for(const id of ["choose-derived-demo","load-derived-demo-tax","tax-crosswalk"])
   assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/v11-ordinary-income-sample\.json/);
 assert.match(html,/v11-derived-tax-plan-example\.json/);
 assert.match(html,/derivedTaxPlan:taxSidecar/);
 assert.match(html,/正式な税引後NPV／IRR/);
});
