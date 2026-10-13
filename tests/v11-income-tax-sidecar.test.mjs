import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fingerprintV11Document,compileV11IncomeTaxSidecar} from "../src/v11-income-tax-sidecar.mjs";
import {previewV11Scenario} from "../src/v11-preview-engine.mjs";
const read=(name)=>JSON.parse(readFileSync(new URL("../preview/"+name,import.meta.url),"utf8"));
const doc=read("v11-sample.json"),sidecar=read("v11-tax-sidecar-example.json");
const clone=x=>structuredClone(x);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} !== ${b}`);
test("External tax sidecar binds to exactly the saved v1.1 document; all 2 taxpayers and 2026 tax heads",()=>{
 assert.equal(sidecar.documentFingerprint,fingerprintV11Document(doc));
 const result=compileV11IncomeTaxSidecar({document:doc,scenarioId:"base",sidecar});
 assert.equal(result.status,"estimated");
 assert.deepEqual(result.expectedKinds["person-1"],["incomeTax","residenceTax","saleGainTax"]);
 assert.deepEqual(result.expectedKinds["corporation-1"],["corporateTax","otherTax"]);
 assert.equal(result.audit.length,10);
 assert.equal(result.incrementalTaxCF,-77000);
 assert.ok(result.entries.some(x=>x.taxKind==="residenceTax"&&x.month==="2028-01"));
});
test("Real v1.1 saved sample connects 2027/2028 externally assumed income tax cash, but never claims full after-tax",()=>{
 const result=previewV11Scenario(doc,{scenarioId:"base",incomeTaxSidecar:sidecar});
 assert.equal(result.status,"estimated-pre-tax");
 assert.equal(result.taxStatus,"incomplete");
 assert.equal(result.incomeTaxStatus,"estimated");
 assert.equal(result.afterTax,null);
 assert.equal(result.incomeTaxCashEvents.reduce((sum,x)=>sum+x.incrementalTaxCF,0),-77000);
 near(result.afterIncomeTaxSensitivity.NPV,
    -1120000+2648000/1.08-74500/(1.08**2)-2500/(1.08**3));
 assert.deepEqual(result.annualIncomeTaxSensitivity.map(x=>x.year),[2026,2027,2028]);
 near(result.annualIncomeTaxSensitivity[1].incrementalTaxCashFlow,-74500);
 near(result.annualIncomeTaxSensitivity[2].incrementalTaxCashFlow,-2500);
});
test("An input edit, other scenario or changed tax year must invalidate previously reviewed assessments",()=>{
 const d=clone(doc);d.units[0].fields.H.H01.value=30000;
 assert.equal(compileV11IncomeTaxSidecar({document:d,scenarioId:"base",sidecar}).status,"incomplete");
 const rerun=previewV11Scenario(d,{scenarioId:"base",incomeTaxSidecar:sidecar});
 assert.equal(rerun.incomeTaxStatus,"incomplete");
 assert.equal(rerun.afterIncomeTaxSensitivity,null);
 assert.equal(compileV11IncomeTaxSidecar({document:doc,scenarioId:"upside",sidecar}).status,"incomplete");
 const other=clone(sidecar);other.withProject[0].taxYear=2027;
 assert.equal(compileV11IncomeTaxSidecar({document:doc,scenarioId:"base",sidecar:other}).status,"incomplete");
});
test("Tax kind missing, unclassified VAT, mismatched payment schedule and duplicated assessment fail closed",()=>{
 const missing=clone(sidecar);missing.withoutProject.pop();
 const x=compileV11IncomeTaxSidecar({document:doc,scenarioId:"base",sidecar:missing});
 assert.equal(x.status,"incomplete");assert.ok(x.missing.some(r=>r.taxKind==="otherTax"));
 const dup=clone(sidecar);dup.withProject.push(clone(dup.withProject[0]));
 assert.equal(compileV11IncomeTaxSidecar({document:doc,scenarioId:"base",sidecar:dup}).status,"incomplete");
 const vat=clone(sidecar);vat.withProject[0].taxKind="consumptionTax";
 assert.equal(compileV11IncomeTaxSidecar({document:doc,scenarioId:"base",sidecar:vat}).status,"incomplete");
 const schedule=clone(sidecar);schedule.withProject[0].paymentMonths=["2027-04"];
 assert.match(compileV11IncomeTaxSidecar({document:doc,scenarioId:"base",sidecar:schedule}).reason,/mismatch/);
});
test("No tax sidecar never becomes fictional zero taxes; zero tax differences are explicit positive evidence",()=>{
 const pending=previewV11Scenario(doc,{scenarioId:"base"});
 assert.equal(pending.incomeTaxStatus,"incomplete");
 assert.equal(pending.afterIncomeTaxSensitivity,null);
 const zero=clone(sidecar);zero.withProject=clone(zero.withoutProject);
 const calc=previewV11Scenario(doc,{scenarioId:"base",incomeTaxSidecar:zero});
 assert.equal(calc.incomeTaxStatus,"estimated");
 assert.equal(calc.afterIncomeTaxSensitivity.NPV,calc.preTax.NPV);
 assert.equal(calc.afterIncomeTaxSensitivity.IRR,calc.preTax.IRR);
});
