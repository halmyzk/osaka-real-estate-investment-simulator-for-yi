import test from "node:test";
import assert from "node:assert/strict";
import {connectAnnualTaxAssessments} from "../src/income-tax-bridge.mjs";
import {evaluatePortfolio} from "../src/portfolio.mjs";
// B-T21 is an accounting identity; the tax rates are not being certified.
const source="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm";
const entities=[{entityId:"person",entityType:"individual"},{entityId:"corp",entityType:"corporation"}];
const make=(entityId,taxYear,taxKind,amount)=>({
 entityId,taxYear,taxKind,amount,id:entityId+"-"+taxYear+"-"+taxKind,
 status:"estimated",ruleVersion:"2026-2027-illustrative",sourceUrl:source
});
const baseline=[
 make("person",2026,"incomeTax",50000),
 make("corp",2026,"corporateTax",80000),
 make("person",2027,"incomeTax",70000),
 make("corp",2027,"corporateTax",90000)
];
const ledgers=[
 {entityId:"person",ledger:{series:[
  {month:"2026-06",operating:600,investing:0,financing:0,pretaxEquityCF:600},
  {month:"2027-06",operating:700,investing:0,financing:0,pretaxEquityCF:700}
 ]}},
 {entityId:"corp",ledger:{series:[
  {month:"2026-06",operating:200,investing:0,financing:0,pretaxEquityCF:200},
  {month:"2027-06",operating:300,investing:0,financing:0,pretaxEquityCF:300}
 ]}}
];
const invest=(taxes)=>evaluatePortfolio({
 entityLedgers:ledgers,taxes:taxes.entries,
 timeZero:[{entityId:"corp",amount:-1000}],
 taxCoverage:[{entityId:"person",status:"estimated"},{entityId:"corp",status:"estimated"}],
 baseCalendarYear:2026,holdingYears:2,discountRate:.08
});
test("B-T21 independent criterion: equal with/without tax paid gives zero incremental tax and identical pre/after CF and NPV",()=>{
 const paid=connectAnnualTaxAssessments({
  entities,assessmentsWithProject:baseline,assessmentsWithoutProject:baseline
 });
 assert.equal(paid.incrementalTaxCF,0);
 assert.ok(paid.entries.every(x=>x.incrementalTaxCF===0));
 const result=invest(paid);
 assert.deepEqual(result.preTax.cashFlows,result.afterTax.cashFlows);
 assert.equal(result.preTax.NPV,result.afterTax.NPV);
 assert.equal(result.preTax.IRR,result.afterTax.IRR);
 assert.equal(result.reconciliation.taxCashFlowTotal,0);
 assert.deepEqual(result.preTax.cashFlows.slice(0,3),[-1000,800,1000]);
});
test("B-T21 independent negative control: 1 yen additional tax in one taxpayer/year changes after-tax CF exactly 1 yen",()=>{
 const changed=baseline.map(x=>x.entityId==="corp"&&x.taxYear===2027?
  {...x,amount:x.amount+1}:x);
 const paid=connectAnnualTaxAssessments({
  entities,assessmentsWithProject:changed,assessmentsWithoutProject:baseline
 });
 assert.equal(paid.incrementalTaxCF,-1);
 const result=invest(paid);
 assert.equal(result.reconciliation.taxCashFlowTotal,-1);
 assert.ok(result.afterTax.NPV<result.preTax.NPV);
 assert.ok(Math.abs((result.reconciliation.preTaxTotal-
  result.reconciliation.afterTaxTotal)-1)<1e-9);
 assert.equal(result.annual.at(-1).year,2028);
});
