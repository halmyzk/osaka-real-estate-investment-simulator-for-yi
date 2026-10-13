import test from "node:test";
import assert from "node:assert/strict";
import {aggregateTaxableCategories,evaluatePortfolio,evaluateAnnualCashFlows} from "../src/portfolio.mjs";
import {incrementalTaxEvents,planTaxPayments} from "../src/tax.mjs";
test("Gate B multiple apartments same entity/tax class aggregate, never net with another taxpayer",()=>{
 const rows=aggregateTaxableCategories([
  {entityId:"person",taxYear:2026,category:"miscellaneous",kind:"revenue",amount:500000},
  {entityId:"person",taxYear:2026,category:"miscellaneous",kind:"revenue",amount:200000},
  {entityId:"person",taxYear:2026,category:"miscellaneous",kind:"deductibleExpense",amount:100000},
  {entityId:"corp",taxYear:2026,category:"corporate",kind:"revenue",amount:400000},
  {entityId:"corp",taxYear:2026,category:"corporate",kind:"deductibleExpense",amount:700000}
 ]);
 assert.equal(rows.length,2);
 assert.equal(rows.find(x=>x.entityId==="person").taxableCategoryProfit,600000);
 assert.equal(rows.find(x=>x.entityId==="corp").taxableCategoryProfit,-300000);
});
test("Gate B entity tax cash differs by entity/payment month; sum increments only when consolidating CF",()=>{
 const a=planTaxPayments({entityId:"person",entityType:"individual",taxYear:2026,
  assessments:[{id:"p-2026",taxKind:"incomeTax",amount:30000}]});
 const b=planTaxPayments({entityId:"corp",entityType:"corporation",taxYear:2026,
  assessments:[{id:"c-2026",taxKind:"corporateTax",amount:70000}]});
 const t=incrementalTaxEvents({withProject:[...a.entries,...b.entries],withoutProject:[]});
 assert.deepEqual(t.entries.map(x=>[x.entityId,x.month,x.incrementalTaxCF]),
  [["corp","2027-02",-70000],["person","2027-03",-30000]]);
 assert.equal(t.incrementalTaxCF,-100000);
 const empty={series:[]};
 const p=evaluatePortfolio({entityLedgers:[{entityId:"corp",ledger:empty},{entityId:"person",ledger:empty}],
  taxes:t.entries,taxCoverage:[{entityId:"corp",status:"estimated"},{entityId:"person",status:"estimated"}],
  baseCalendarYear:2026,holdingYears:1,discountRate:.08});
 assert.deepEqual(p.afterTax.cashFlows,[0,0,-100000]);
 assert.equal(p.annual.at(-1).year,2027);
});
test("Gate A zero CF/no initial equity => IRR N/A; genuine negative IRR is retained",()=>{
 assert.equal(evaluateAnnualCashFlows({cashFlows:[0,0,100],discountRate:.08}).IRR,null);
 const r=evaluateAnnualCashFlows({cashFlows:[-100,90],discountRate:.08});
 assert.ok(Math.abs(r.IRR+0.1)<1e-9);
 assert.equal(r.irrStatus,"computed");
});
test("Gate A two IRRs and no-real-root patterns never produce a misleading single IRR",()=>{
 const multi=evaluateAnnualCashFlows({cashFlows:[-100,230,-132],discountRate:.08});
 assert.equal(multi.irrStatus,"ambiguous");
 assert.equal(multi.IRR,null);
 const none=evaluateAnnualCashFlows({cashFlows:[-100,30,-90],discountRate:.08});
 assert.equal(none.IRR,null);
});
test("Gate A discount rate negative one rejected and NPV missing rate not substituted",()=>{
 assert.throws(()=>evaluateAnnualCashFlows({cashFlows:[-100,200],discountRate:-1}));
 assert.equal(evaluateAnnualCashFlows({cashFlows:[-100,200]}).NPV,null);
});
