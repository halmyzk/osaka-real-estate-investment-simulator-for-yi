import test from "node:test";
import assert from "node:assert/strict";
import {calculatePrivateUseReduction,calculateMixedUseIndividualSaleBasis} from "../src/personal-sale-basis.mjs";
import {landBuildingSaleGain,planTaxPayments,incrementalTaxEvents} from "../src/tax.mjs";
import {individualSaleGainTax} from "../src/tax-detail.mjs";
import {evaluatePortfolio} from "../src/portfolio.mjs";
const NTA2108="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2108_qa.htm";
const NTA3261="https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3261.htm";
const NTA3208="https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3208.htm";
const rule={sourceUrl:NTA2108,version:"NTA-2108-2026-scenario",basis:"reviewedScenario"};
const common={acquiredAt:"2016-01-10",convertedAt:"2023-04-01",
 buildingAcquisitionCost:10000000,statutoryUsefulLifeYears:22,
 oldStraightLineUsefulLifeYears:33,oldStraightLineRate:.031,rule};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test("B-T19 official NTA 2108: 2016 Jan 10 to 2023 Apr 1 -> 7 years, reduction 1,953,000, basis 8,047,000",()=>{
 const r=calculatePrivateUseReduction(common);
 assert.equal(r.period.roundedPrivateUseYears,7);
 assert.equal(r.privateReduction,1953000);
 assert.equal(r.atConversionBookValue,8047000);
});
test("B-T19 exact six-month threshold and mandatory 1.5x old useful life",()=>{
 const a={...common,acquiredAt:"2020-01-01",convertedAt:"2025-06-30"};
 const b={...a,convertedAt:"2025-07-01"};
 assert.equal(calculatePrivateUseReduction(a).period.roundedPrivateUseYears,5);
 assert.equal(calculatePrivateUseReduction(b).period.roundedPrivateUseYears,6);
 assert.throws(()=>calculatePrivateUseReduction({...common,oldStraightLineUsefulLifeYears:22}));
});
test("B-T19 private-use portion capped at 95% of original acquisition cost",()=>{
 const r=calculatePrivateUseReduction({...common,convertedAt:"2090-04-01"});
 assert.equal(r.privateReduction,9500000);
 assert.equal(r.atConversionBookValue,500000);
});
const business=(gross=472500,deductible=236250)=>[{
 taxYear:2023,ownerEntityId:"person",sourceAssetId:"building1",
 grossBookReduction:gross,businessDeduction:deductible,
 reviewedForDisposalBasis:true,evidenceUrl:NTA3261
}];
const saleArgs={...common,buildingId:"building1",ownerEntityId:"person",
 soldAt:"2026-10-01",businessDepreciationLedger:business(),
 consecutiveBusinessCoverageReviewed:true};
test("B-T19 gross business depreciation affects disposal basis even if only 50% expensed",()=>{
 const x=calculateMixedUseIndividualSaleBasis(saleArgs);
 assert.equal(x.nonBusinessReduction,1953000);
 assert.equal(x.businessBookReduction,472500);
 assert.equal(x.businessDeductibleExpenseHistory,236250);
 assert.equal(x.unclaimedBusinessDepreciationEquivalents,236250);
 assert.equal(x.adjustedBuildingBasis,7574500);
 assert.equal(x.acquisitionCostReconciliation,0);
});
test("B-T19 unverified disposal basis history, overdepreciation and reused period refused",()=>{
 assert.throws(()=>calculateMixedUseIndividualSaleBasis({...saleArgs,consecutiveBusinessCoverageReviewed:false}));
 assert.throws(()=>calculateMixedUseIndividualSaleBasis({...saleArgs,businessDepreciationLedger:business(9000000,0)}));
 assert.throws(()=>calculateMixedUseIndividualSaleBasis({...saleArgs,businessDepreciationLedger:[...business(),...business()]}));
 assert.throws(()=>calculateMixedUseIndividualSaleBasis({...saleArgs,nonBusinessAfterConversion:true}));
});
test("B-T19/B-T20 personal nonbusiness sale basis -> separate gains tax -> next-year actual tax CF",()=>{
 const basis=calculateMixedUseIndividualSaleBasis(saleArgs);
 const gain=landBuildingSaleGain({ownerType:"individual",purchaseDate:"2016-01-10",
  saleDate:"2026-10-01",proceeds:20000000,sellingCosts:1000000,
  adjustedLandBasis:5000000,adjustedBuildingBasis:basis.adjustedBuildingBasis});
 assert.equal(gain.holdingClass,"long");
 assert.equal(gain.taxableGain,6425500);
 const tax=individualSaleGainTax({taxYear:2026,taxableGain:gain.taxableGain,holdingClass:"long",
  reconstructionRate:.021,defenseIncomeRate:0,ruleSourceUrl:NTA3208});
 near(tax.totalTaxBeforeRounding,1305340.325);
 const project=planTaxPayments({entityId:"person",entityType:"individual",taxYear:2026,
  assessments:[{id:"saleGain",taxKind:"saleGainTax",amount:tax.totalTaxBeforeRounding}]});
 const base=planTaxPayments({entityId:"person",entityType:"individual",taxYear:2026,
  assessments:[{id:"saleGain",taxKind:"saleGainTax",amount:0}]});
 const events=incrementalTaxEvents({withProject:project.entries,withoutProject:base.entries});
 const p=evaluatePortfolio({entityLedgers:[{entityId:"person",ledger:{series:[
  {month:"2026-10",operating:0,investing:19000000,financing:0,pretaxEquityCF:19000000}
 ]}}],taxes:events.entries,taxCoverage:[{entityId:"person",status:"estimated"}],
  timeZero:[{entityId:"person",amount:-15000000}],
  baseCalendarYear:2026,holdingYears:1,discountRate:.08});
 assert.equal(p.annual[1].year,2027);
 near(p.annual[1].taxCashFlow,-1305340.325);
 near(p.reconciliation.afterTaxTotal,19000000-15000000-1305340.325);
});
