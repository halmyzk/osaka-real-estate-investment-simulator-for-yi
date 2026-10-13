import test from "node:test";
import assert from "node:assert/strict";
import {verifyAssessmentCoverage,evaluateUnleveredAfterTax} from "../src/tax-integrity.mjs";
const url="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm";
const row=(entityId,taxYear,taxKind,amount=0)=>({entityId,taxYear,taxKind,amount,status:"estimated",ruleVersion:"fixture",sourceUrl:url});
const ent=[{entityId:"personal"},{entityId:"corp"}], kinds={personal:["incomeTax","residenceTax"],corp:["corporateTax","otherTax"]};
const full=[row("personal",2026,"incomeTax"),row("personal",2026,"residenceTax"),row("corp",2026,"corporateTax"),row("corp",2026,"otherTax")];
test("B-T24: explicit zero assessment for each entity, year and kind is required",()=>{
 const r=verifyAssessmentCoverage({entities:ent,assessmentYears:[2026],requiredKinds:kinds,withProject:full,withoutProject:full});
 assert.equal(r.eligibleForTaxCashBridge,true);assert.equal(r.status,"estimated");assert.equal(r.statuses.length,8);
 const missing=verifyAssessmentCoverage({entities:ent,assessmentYears:[2026],requiredKinds:kinds,withProject:full,withoutProject:full.slice(0,-1)});
 assert.equal(missing.status,"incomplete");assert.equal(missing.missing[0].taxKind,"otherTax");
});
test("B-T05: one entity's complete data cannot mask another entity's missing year",()=>{
 const r=verifyAssessmentCoverage({entities:ent,assessmentYears:[2026,2027],requiredKinds:kinds,withProject:full,withoutProject:full});
 assert.equal(r.status,"incomplete");assert.equal(r.missing.length,8);
});
test("duplicated tax kind per entity-year is rejected even with distinct assessment IDs",()=>{
 assert.throws(()=>verifyAssessmentCoverage({entities:ent,assessmentYears:[2026],requiredKinds:kinds,withProject:[...full,full[0]],withoutProject:full}));
 assert.throws(()=>verifyAssessmentCoverage({entities:ent,assessmentYears:[2026],requiredKinds:kinds,withProject:[{...full[0],amount:null},...full.slice(1)],withoutProject:full}));
});
const economic=[{entityId:"corp",ledger:{series:[{month:"2026-12",operating:1200000,investing:0,financing:0,pretaxEquityCF:1200000}]}}];
const evidence={method:"debtFreeTaxRecalculation",debtInterestExcluded:true,taxBaseRecomputed:true,evidenceId:"unlevered-tax-recalculation-1"};
test("Gate B debt-free tax recomputation supports standalone after-tax NPV/IRR",()=>{
 const r=evaluateUnleveredAfterTax({unleveredEntityLedgers:economic,taxCoverage:[{entityId:"corp",status:"estimated"}],
  unleveredTaxEvents:[{entityId:"corp",month:"2027-02",taxKind:"corporateTax",incrementalTaxCF:-100000}],
  independentTaxEvidence:evidence,timeZero:[{entityId:"corp",amount:-1000000}],
  baseCalendarYear:2026,holdingYears:1,discountRate:.08});
 assert.equal(r.valuationBasis,"unlevered-independent-after-tax");
 assert.deepEqual(r.afterTax.cashFlows,[-1000000,1200000,-100000]);
 assert.ok(r.afterTax.NPV>0);
});
test("adding debt back to levered after-tax CF does not qualify as unlevered independent recomputation",()=>{
 const opts={unleveredEntityLedgers:economic,unleveredTaxEvents:[],taxCoverage:[{entityId:"corp",status:"estimated"}],
 baseCalendarYear:2026,holdingYears:1,discountRate:.08};
 assert.throws(()=>evaluateUnleveredAfterTax({...opts,independentTaxEvidence:{...evidence,taxBaseRecomputed:false}}));
 assert.throws(()=>evaluateUnleveredAfterTax({...opts,independentTaxEvidence:evidence,
 unleveredEntityLedgers:[{entityId:"corp",ledger:{series:[{month:"2026-12",operating:100,investing:0,financing:200,pretaxEquityCF:300}]}}]}));
});
