import test from "node:test";
import assert from "node:assert/strict";
import {evaluatePortfolio,evaluateAnnualCashFlows,aggregateTaxableCategories} from "../src/portfolio.mjs";
const ledger=(rows)=>({series:rows.map(([month,ocf,icf=0,fin=0])=>({month,operating:ocf,investing:icf,financing:fin,pretaxEquityCF:ocf+icf+fin}))});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test("IRR 10%, NPV 18,518.5185 from independent year-end cash flows",()=>{
 const a=evaluateAnnualCashFlows({cashFlows:[-1000000,1100000],discountRate:.08});
 near(a.IRR,.1);near(a.NPV,18518.5185185185);
 assert.equal(a.irrStatus,"computed");
});
test("discount rate missing suppresses only NPV",()=>{
 const a=evaluateAnnualCashFlows({cashFlows:[-1000000,1100000]});
 assert.equal(a.NPV,null);near(a.IRR,.1);assert.equal(a.npvStatus,"incomplete");
});
test("no initial outlay and one sign have no valid investment IRR",()=>{
 const r=evaluateAnnualCashFlows({cashFlows:[0,1000],discountRate:.1});
 assert.equal(r.IRR,null);assert.equal(r.irrStatus,"notApplicable");
 assert.throws(()=>evaluateAnnualCashFlows({cashFlows:[-1,2],discountRate:-1}));
});
test("nonconventional sign series produces ambiguity warning",()=>{
 const r=evaluateAnnualCashFlows({cashFlows:[-100,230,-132],discountRate:.05});
 assert.equal(r.IRR,null);assert.equal(r.irrStatus,"ambiguous");
 assert.ok(r.irrDetails.signChanges>1);
});
test("two owners: common calendar-year accumulation, not averaged IRR",()=>{
 const r=evaluatePortfolio({
  entityLedgers:[
   {entityId:"p",ledger:ledger([["2026-02",1100000],["2027-03",100000]])},
   {entityId:"corp",ledger:ledger([["2026-05",2200000],["2027-03",200000]])}
  ],
  timeZero:[{entityId:"p",amount:-1000000},{entityId:"corp",amount:-2000000}],
  taxCoverage:[{entityId:"p",status:"computed"},{entityId:"corp",status:"computed"}],
  baseCalendarYear:2026,holdingYears:2,discountRate:.08
 });
 assert.deepEqual(r.preTax.cashFlows,[-3000000,3300000,300000]);
 assert.deepEqual(r.afterTax.cashFlows,r.preTax.cashFlows);
 assert.equal(r.annual.length,2);
 assert.equal(r.reconciliation.preTaxTotal,600000);
 assert.equal(r.taxStatus,"computed");
});
test("tax-paid year 11 appended rather than truncated at disposal",()=>{
 const p=evaluatePortfolio({
  entityLedgers:[{entityId:"i",ledger:ledger([["2035-12",10500000]])}],
  timeZero:[{entityId:"i",amount:-9500000}],
  taxes:[{entityId:"i",month:"2036-03",taxKind:"saleGainTax",incrementalTaxCF:-200000}],
  taxCoverage:[{entityId:"i",status:"estimated"}],
  baseCalendarYear:2026,holdingYears:10,discountRate:.08
 });
 assert.equal(p.annual.length,11);
 assert.equal(p.annual.at(-1).taxCashFlow,-200000);
 assert.equal(p.afterTax.cashFlows.length,12);
 assert.equal(p.taxStatus,"estimated");
});
test("tax missing for even one entity suppresses after-tax KPIs, not pre-tax",()=>{
 const p=evaluatePortfolio({
  entityLedgers:[{entityId:"person",ledger:ledger([["2026-06",200]])},{entityId:"corp",ledger:ledger([["2026-06",400]])}],
  taxCoverage:[{entityId:"person",status:"computed"}],
  baseCalendarYear:2026,holdingYears:1,discountRate:.08
 });
 assert.equal(p.afterTax.NPV,null);
 assert.equal(p.afterTax.irrStatus,"incomplete");
 assert.equal(p.preTax.cashFlows[1],600);
});
test("entity tax category amounts do not net different taxpayers",()=>{
 const a=aggregateTaxableCategories([
  {entityId:"one",taxYear:2026,category:"miscellaneous",kind:"revenue",amount:500000},
  {entityId:"one",taxYear:2026,category:"miscellaneous",kind:"deductibleExpense",amount:700000},
  {entityId:"two",taxYear:2026,category:"corporate",kind:"revenue",amount:300000}
 ]);
 assert.equal(a.length,2);
 assert.equal(a.find(x=>x.entityId==="one").taxableCategoryProfit,-200000);
 assert.equal(a.find(x=>x.entityId==="two").taxableCategoryProfit,300000);
});
test("paired intercompany rental cancels economically; taxes stay separately attributed",()=>{
 const result=evaluatePortfolio({
  entityLedgers:[
   {entityId:"owner",ledger:ledger([["2026-01",100000]])},
   {entityId:"tenant",ledger:ledger([["2026-01",-100000]])}
  ],
  internalTransfers:[{id:"rent",month:"2026-01",fromEntityId:"tenant",toEntityId:"owner",amount:100000,
   fromLedgerAmount:-100000,toLedgerAmount:100000}],
  taxCoverage:[{entityId:"owner",status:"estimated"},{entityId:"tenant",status:"estimated"}],
  baseCalendarYear:2026,holdingYears:1,discountRate:.08
 });
 assert.equal(result.preTax.cashFlows[1],0);
 assert.equal(result.taxStatus,"estimated");
 assert.throws(()=>evaluatePortfolio({entityLedgers:[
   {entityId:"owner",ledger:ledger([["2026-01",100000]])},
   {entityId:"tenant",ledger:ledger([["2026-01",-100000]])}],
   internalTransfers:[{id:"bad",month:"2026-01",fromEntityId:"tenant",toEntityId:"owner",amount:100000,fromLedgerAmount:-100000,toLedgerAmount:90000}],
   baseCalendarYear:2026,holdingYears:1}));
});
test("invalid operating/financing reconciliation fails",()=>{
 assert.throws(()=>evaluatePortfolio({
   entityLedgers:[{entityId:"e",ledger:{series:[{month:"2026-01",operating:100,investing:0,financing:0,pretaxEquityCF:200}]}}],
   baseCalendarYear:2026,holdingYears:1
 }),RangeError);
});
