import test from "node:test";
import assert from "node:assert/strict";
import {compileVATInclusiveCash,attachVATCashToEntityLedgers} from "../src/vat-cash.mjs";
import {evaluatePortfolio} from "../src/portfolio.mjs";
const rows=[
 {id:"stay",entityId:"person",month:"2026-06",kind:"sale",netAmount:200000,vatAmount:20000,vatClass:"taxable",cashGrossAmount:220000},
 {id:"lease",entityId:"corp",month:"2026-06",kind:"sale",netAmount:300000,vatAmount:0,vatClass:"exempt",cashGrossAmount:300000},
 {id:"fit",entityId:"person",month:"2026-06",kind:"capital",netAmount:100000,vatAmount:10000,vatClass:"taxable",cashGrossAmount:110000},
 {id:"clean",entityId:"person",month:"2026-06",kind:"expense",netAmount:20000,vatAmount:2000,vatClass:"taxable",cashGrossAmount:22000}
];
const coverage=[{entityId:"person",status:"estimated"},{entityId:"corp",status:"computed"}];
const empty=[{entityId:"person",ledger:{series:[]}},{entityId:"corp",ledger:{series:[]}}];
test("VAT gross cash ledger: operating vs capital vs settlement and exact entity amounts",()=>{
 const result=compileVATInclusiveCash({lines:rows,taxCoverage:coverage,
  taxSettlements:[{id:"vat-due",entityId:"person",month:"2027-03",kind:"payment",amount:8000}]});
 assert.equal(result.status,"estimated");
 const person=result.entityResults.find(x=>x.entityId==="person");
 assert.equal(person.amount,220000-110000-22000-8000);
 assert.equal(person.items.filter(x=>x.kind==="investing").length,1);
 const linked=attachVATCashToEntityLedgers({baseLedgers:empty,vatBridge:result,provenance:"netPnlExcludedFromCash"});
 const p=evaluatePortfolio({entityLedgers:linked,baseCalendarYear:2026,holdingYears:1,discountRate:.08,
  taxCoverage:[{entityId:"person",status:"computed"},{entityId:"corp",status:"computed"}]});
 assert.deepEqual(p.preTax.cashFlows,[0,388000,-8000]);
});
test("assessment is not paid until settlement exists; unconfirmed refunds blocked",()=>{
 const x=compileVATInclusiveCash({lines:[rows[0]],taxCoverage:[coverage[0]]});
 assert.equal(x.lines.length,1);assert.equal(x.lines[0].amount,220000);
 assert.throws(()=>compileVATInclusiveCash({lines:[rows[0]],taxCoverage:[coverage[0]],taxSettlements:[
  {id:"refund",entityId:"person",month:"2027-03",kind:"refund",amount:1000}]}));
});
test("missing VAT tax coverage rejects cash bridge before valuation",()=>{
 const x=compileVATInclusiveCash({lines:[rows[0]],taxCoverage:[]});
 assert.equal(x.status,"incomplete");
 assert.throws(()=>attachVATCashToEntityLedgers({baseLedgers:empty,vatBridge:x,provenance:"netPnlExcludedFromCash"}));
});
test("duplicate receipt, duplicate settlement and inconsistent gross are rejected",()=>{
 assert.throws(()=>compileVATInclusiveCash({lines:[rows[0],rows[0]],taxCoverage:coverage}));
 assert.throws(()=>compileVATInclusiveCash({lines:[{...rows[0],cashGrossAmount:200000}],taxCoverage:coverage}));
 assert.throws(()=>compileVATInclusiveCash({lines:[],taxCoverage:coverage,taxSettlements:[
  {id:"t",entityId:"person",month:"2027-03",kind:"payment",amount:1},
  {id:"t",entityId:"person",month:"2027-04",kind:"payment",amount:1}]}));
});
test("never attach gross VAT ledger atop pre-existing net P/L booking without explicit isolation",()=>{
 const b=compileVATInclusiveCash({lines:[rows[0]],taxCoverage:[coverage[0]]});
 assert.throws(()=>attachVATCashToEntityLedgers({baseLedgers:empty,vatBridge:b}));
 assert.throws(()=>attachVATCashToEntityLedgers({baseLedgers:[{entityId:"person",ledger:{series:[
  {month:"2026-06",operating:200000,investing:0,financing:0,pretaxEquityCF:200000,vatCashIncluded:true}]}}],
  vatBridge:b,provenance:"netPnlExcludedFromCash"}));
});
