import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {previewV11Scenario} from "../src/v11-preview-engine.mjs";
import {buildV11TaxSourceCrosswalk} from "../src/v11-tax-source-crosswalk.mjs";
const data=JSON.parse(readFileSync(new URL("../preview/v11-sample.json",import.meta.url),"utf8"));
test("Audit crosswalk splits income/expenses for person M3 and corporation M4 without treating disposition cash as operating revenue",()=>{
 const p=previewV11Scenario(data,{scenarioId:"base"});
 assert.equal(p.taxSourceCrosswalk.status,"auditOnly");
 assert.equal(p.taxSourceCrosswalk.legalTaxableIncome,null);
 assert.equal(p.taxSourceCrosswalk.rows.length,2);
 const personal=p.taxSourceCrosswalk.rows.find(x=>x.entityId==="person-1");
 const corp=p.taxSourceCrosswalk.rows.find(x=>x.entityId==="corporation-1");
 assert.equal(personal.lodgingRevenue,1080000);
 assert.equal(personal.rentalRevenue,0);
 assert.equal(personal.disposalGrossCash,1000000);
 assert.equal(personal.purchaseCapitalCash,1000000);
 assert.equal(personal.revenueGrossForTaxReview,1080000);
 assert.equal(personal.taxableIncome,null);
 assert.equal(corp.rentalRevenue,1080000);
 assert.equal(corp.propertyOperatingExpense,12000);
 assert.equal(corp.masterRentExpense,600000);
 assert.equal(corp.operatingSurplus,468000);
 assert.equal(corp.cashOperatingExpenseForReview,612000);
 assert.equal(corp.revenueGrossForTaxReview,1080000);
 assert.equal(corp.debtDrawdowns,0);
 assert.equal(corp.taxableIncomeStatus,"incomplete");
 for(const x of [corp,personal])assert.equal(x.operatingReconciliationDifference,0);
});
test("Audit crosswalk separately shows loan draw, principal, and interest without mistaking principal for deductible expense",()=>{
 const d=structuredClone(data);
 d.units[0].loans=[{id:"loan",borrowerEntityId:"person-1",drawDate:"2026-01-01",
   principal:600000,annualInterestRate:12,termMonths:12,repaymentMethod:"equalPrincipal"}];
 const p=previewV11Scenario(d);
 const personal=p.taxSourceCrosswalk.rows.find(x=>x.entityId==="person-1");
 assert.equal(personal.debtDrawdowns,600000);
 assert.ok(personal.principalPaid>0);
 assert.ok(personal.interestCashPaid>0);
 assert.equal(personal.taxableIncome,null);
 assert.equal(personal.revenueGrossForTaxReview,1080000);
 assert.equal(personal.cashOperatingExpenseForReview,0);
});
test("Audit crosswalk insists on January-based fiscal years and known entity IDs",()=>{
 const preview=previewV11Scenario(data);
 const d=structuredClone(data);d.entities[0].taxYearStartMonth=4;
 assert.throws(()=>buildV11TaxSourceCrosswalk({document:d,unitResults:preview.units}),/fiscal/);
 const bad=structuredClone(preview.units);bad[0].entityId="missing";
 assert.throws(()=>buildV11TaxSourceCrosswalk({document:data,unitResults:bad}),/entity/);
});
