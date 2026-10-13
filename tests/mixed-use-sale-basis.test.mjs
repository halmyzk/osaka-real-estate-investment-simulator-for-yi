import test from "node:test";
import assert from "node:assert/strict";
import {reconcileConcurrentUseSaleBasis,screenNonBusiness90PercentTreatment} from "../src/mixed-use-sale-basis.mjs";
import {landBuildingSaleGain} from "../src/tax.mjs";
const source="https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3261.htm";
const circular="https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/05/18.htm";
const months=Array.from({length:24},(_,i)=>({
 month:(2024+Math.floor(i/12))+"-"+String(i%12+1).padStart(2,"0"),
 businessShare:.4,privateShare:.6,
 businessGrossEquivalent:20000,nonbusinessGrossEquivalent:10000,
 businessActualDeducted:12000,reviewedDisposalTreatment:true,evidenceUrl:source
}));
const inputs={buildingId:"mixed1",ownerEntityId:"individual",
 acquiredAt:"2024-01-01",soldAt:"2025-12-31",acquisitionBasis:10000000,
 monthlyRecords:months,splitCalculationReviewed:true,
 dispositionExclusionReviewed:true,ruleVersion:"tax-scenario-2025"};
test("B-T19 contemporaneous 40% lodging and 60% private: explicitly attributed full disposal reductions",()=>{
 const r=reconcileConcurrentUseSaleBasis(inputs);
 assert.equal(r.businessBookReduction,480000);
 assert.equal(r.nonbusinessBookReduction,240000);
 assert.equal(r.deductibleBusinessExpenseHistory,288000);
 assert.equal(r.nonDeductedBusinessReduction,192000);
 assert.equal(r.adjustedBuildingBasis,9280000);
 assert.equal(r.status,"estimated");
 const gain=landBuildingSaleGain({ownerType:"individual",purchaseDate:"2024-01-01",
  saleDate:"2025-12-31",proceeds:15000000,sellingCosts:500000,
  adjustedLandBasis:2000000,adjustedBuildingBasis:r.adjustedBuildingBasis});
 assert.equal(gain.taxableGain,3220000);
});
test("B-T19 monthly coverage is exhaustive, and independent disposal review cannot be omitted",()=>{
 assert.throws(()=>reconcileConcurrentUseSaleBasis({...inputs,monthlyRecords:months.slice(1)}));
 assert.throws(()=>reconcileConcurrentUseSaleBasis({...inputs,monthlyRecords:[...months,months[0]]}));
 assert.throws(()=>reconcileConcurrentUseSaleBasis({...inputs,splitCalculationReviewed:false}));
 assert.throws(()=>reconcileConcurrentUseSaleBasis({...inputs,monthlyRecords:[
   {...months[0],businessShare:.5},...months.slice(1)]}));
 assert.throws(()=>reconcileConcurrentUseSaleBasis({...inputs,monthlyRecords:[
   {...months[0],businessActualDeducted:30000},...months.slice(1)]}));
});
test("NTA 38-3 90% non-business threshold is a separately reviewed choice, not an automatic deduction",()=>{
 const at90=months.map(m=>({...m,businessShare:.1,privateShare:.9}));
 const a=screenNonBusiness90PercentTreatment({monthlyRecords:at90,electedTreatment:false});
 assert.equal(a.status,"incomplete");
 assert.equal(a.totalNonbusinessShareCondition,true);
 const b=screenNonBusiness90PercentTreatment({monthlyRecords:at90,
  electedTreatment:true,legalReview:{sourceUrl:circular,
   reviewedForOwnershipEntirePeriod:true,applicabilityReviewed:true}});
 assert.equal(b.qualifiesUnderReviewedScenario,true);
 const below=screenNonBusiness90PercentTreatment({monthlyRecords:[
  {...at90[0],privateShare:.899,businessShare:.101},...at90.slice(1)],
  electedTreatment:true,legalReview:{sourceUrl:circular,
   reviewedForOwnershipEntirePeriod:true,applicabilityReviewed:true}});
 assert.equal(below.status,"incomplete");
});
test("Unverified more-than-acquisition cost reductions cannot produce negative basis",()=>{
 const inflated=months.map(m=>({...m,businessGrossEquivalent:450000,nonbusinessGrossEquivalent:10000}));
 assert.throws(()=>reconcileConcurrentUseSaleBasis({...inputs,monthlyRecords:inflated}));
});
