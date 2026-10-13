import test from "node:test";
import assert from "node:assert/strict";
import {assessResidentialBuildingVATLaterAdjustment,computeVATWithReviewedResidentialAdjustment} from "../src/vat-building-adjustment.mjs";
import {compileVATInclusiveCash,attachVATCashToEntityLedgers} from "../src/vat-cash.mjs";
import {evaluatePortfolio} from "../src/portfolio.mjs";
const base={assetId:"rental-house",entityId:"corp",
 acquiredAt:"2023-04-01",thirdTaxPeriodEnd:"2026-03-31",
 eventDate:"2025-06-01",taxPeriodEnd:"2026-03-31",
 reviewedLegalEligibility:"reviewedEligible",heldAtThirdPeriodEnd:true,
 restrictedAcquisitionVAT:2000,taxableRentalConsideration:400,
 exemptRentalConsideration:600,ruleVersion:"NTA-R02-2020",
 sourceReference:"https://www.nta.go.jp/publication/pamph/shohi/r02kaisei.pdf"};
test("B4 official NTA 2020 retained residential building example: 2,000 × 400/(600+400) = 800",()=>{
 const r=assessResidentialBuildingVATLaterAdjustment({...base,eventType:"retainedTaxableRental"});
 assert.equal(r.inputVATCreditAdjustment,800);
 assert.equal(r.eligibleFraction,.4);
 assert.equal(r.cashRefund,null);
 assert.equal(r.taxPeriodEnd,"2026-03-31");
});
test("B4 official NTA 2020 disposed building example: 1,000 × 7,200/(800+7,200) = 900",()=>{
 const r=assessResidentialBuildingVATLaterAdjustment({...base,eventType:"disposed",
 eventDate:"2025-12-01",heldAtThirdPeriodEnd:false,
 restrictedAcquisitionVAT:1000,taxableRentalConsideration:0,
 exemptRentalConsideration:800,buildingDisposalConsideration:7200});
 assert.equal(r.inputVATCreditAdjustment,900);
 assert.equal(r.numeratorConsideration,7200);
 assert.equal(r.denominatorConsideration,8000);
 assert.equal(r.cashRefund,null);
});
test("B4 unknown legal eligibility cannot enter VAT assessment or cash flow",()=>{
 const unreviewed=assessResidentialBuildingVATLaterAdjustment({...base,eventType:"retainedTaxableRental",
 reviewedLegalEligibility:"unknown"});
 assert.equal(unreviewed.status,"incomplete");
 assert.equal(unreviewed.inputVATCreditAdjustment,null);
 assert.throws(()=>computeVATWithReviewedResidentialAdjustment({
  entityId:"corp",taxPeriodEnd:"2026-03-31",outputVAT:900,
  ordinaryEligibleInputVAT:0,residentialAdjustments:[unreviewed]}));
});
test("B4 explicit event/disposal period mismatch and double adjustment fail closed",()=>{
 assert.throws(()=>assessResidentialBuildingVATLaterAdjustment({...base,eventType:"disposed",
 heldAtThirdPeriodEnd:false,buildingDisposalConsideration:7200,
 eventDate:"2026-04-01"}));
 assert.throws(()=>assessResidentialBuildingVATLaterAdjustment({...base,eventType:"retainedTaxableRental",
 buildingDisposalConsideration:1}));
 const retained=assessResidentialBuildingVATLaterAdjustment({...base,eventType:"retainedTaxableRental"});
 assert.throws(()=>computeVATWithReviewedResidentialAdjustment({
 entityId:"corp",taxPeriodEnd:"2026-03-31",outputVAT:1000,
 ordinaryEligibleInputVAT:0,residentialAdjustments:[retained,retained]}));
});
test("B4 adjustment reduces assessed VAT but a negative amount never auto-creates refund cash",()=>{
 const x=assessResidentialBuildingVATLaterAdjustment({...base,eventType:"disposed",
 eventDate:"2025-12-01",heldAtThirdPeriodEnd:false,
 restrictedAcquisitionVAT:1000,taxableRentalConsideration:0,
 exemptRentalConsideration:800,buildingDisposalConsideration:7200});
 const pending=computeVATWithReviewedResidentialAdjustment({
  entityId:"corp",taxPeriodEnd:"2026-03-31",
  outputVAT:500,ordinaryEligibleInputVAT:0,residentialAdjustments:[x]});
 assert.equal(pending.status,"incomplete");
 assert.equal(pending.taxAssessment,-400);
 assert.equal(pending.refundEligible,null);
 const assessed=computeVATWithReviewedResidentialAdjustment({
  entityId:"corp",taxPeriodEnd:"2026-03-31",outputVAT:500,
  ordinaryEligibleInputVAT:0,residentialAdjustments:[x],actualRefundConfirmed:true});
 assert.equal(assessed.refundEligible,400);
 assert.equal(assessed.refundCashBooked,false);
 const gross=compileVATInclusiveCash({lines:[],taxCoverage:[{entityId:"corp",status:"estimated"}],
  taxSettlements:[{id:"actual-refund",entityId:"corp",month:"2026-05",kind:"refund",amount:400,refundConfirmed:true}]});
 const baseLedgers=[{entityId:"corp",ledger:{series:[
  {month:"2025-12",operating:0,investing:7200,financing:0,pretaxEquityCF:7200}]}}];
 const joined=attachVATCashToEntityLedgers({baseLedgers,vatBridge:gross,provenance:"netPnlExcludedFromCash"});
 const p=evaluatePortfolio({entityLedgers:joined,baseCalendarYear:2025,holdingYears:2,discountRate:.08,
  taxCoverage:[{entityId:"corp",status:"estimated"}]});
 assert.deepEqual(p.preTax.cashFlows,[0,7200,400]);
 assert.equal(p.reconciliation.preTaxTotal,7600);
 // VAT refund is one confirmed cash event; original property sale stays once.
});
