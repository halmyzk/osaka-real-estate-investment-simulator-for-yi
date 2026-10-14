import test from "node:test";
import assert from "node:assert/strict";
import {classifyAcquisitionInputVAT,assessResidentialRentalVATAdjustment} from "../src/vat-restrictions.mjs";
const src="https://www.nta.go.jp/law/shitsugi/shohi/19/22.htm";
const rule={taxYear:2026,ruleVersion:"B4-scenario-2026",sourceUrl:src,
 eligibilityBasis:"assumption",residentialRestrictionReviewed:true};
test("B-T16 restricted residential rental building acquisition has no immediate input VAT credit",()=>{
 const r=classifyAcquisitionInputVAT({assetId:"apartment",propertyUse:"residentialRentalBuilding",
  inputVAT:5000000,taxpayerVATStatus:"taxable",taxMethod:"general",
  inputCreditClassification:"residentialRestricted",taxRule:rule});
 assert.equal(r.status,"estimated");
 assert.equal(r.immediateCredit,0);
 assert.equal(r.restrictedVAT,5000000);
});
test("B-T16 VAT-exempt taxpayer cannot claim acquisition input VAT refund",()=>{
 const r=classifyAcquisitionInputVAT({assetId:"fitout",propertyUse:"otherCapitalAsset",inputVAT:200000,
  taxpayerVATStatus:"exempt",taxMethod:"general",inputCreditClassification:"reviewedEligible",taxRule:rule});
 assert.equal(r.immediateCredit,0);
});
test("Unverified property tax credit eligibility is not silently credited nor set to legal zero",()=>{
 const unknown=classifyAcquisitionInputVAT({assetId:"property",propertyUse:"residentialRentalBuilding",
  inputVAT:500000,taxpayerVATStatus:"taxable",taxMethod:"general",
  inputCreditClassification:"unknown",taxRule:rule});
 assert.equal(unknown.status,"incomplete");
 assert.equal(unknown.immediateCredit,null);
 assert.throws(()=>classifyAcquisitionInputVAT({assetId:"property",propertyUse:"residentialRentalBuilding",
  inputVAT:500000,taxpayerVATStatus:"taxable",taxMethod:"general",
  inputCreditClassification:"reviewedEligible",taxRule:{...rule,residentialRestrictionReviewed:false}}));
});
test("B-T17 simplified taxation cannot use one invoice's input VAT as claim",()=>{
 const r=classifyAcquisitionInputVAT({assetId:"furniture",propertyUse:"otherCapitalAsset",
  inputVAT:100000,taxpayerVATStatus:"taxable",taxMethod:"simplified",
  inputCreditClassification:"reviewedEligible",taxRule:rule});
 assert.equal(r.status,"incomplete");
 assert.equal(r.immediateCredit,null);
});
test("Reviewed third-period conversion to lodging yields VAT adjustment to tax calculation, not cash refund",()=>{
 const result=assessResidentialRentalVATAdjustment({assetId:"apart",restrictedAcquisitionVAT:5000000,
  adjustmentTaxYear:2028,eligibility:"reviewedEligible",
  adjustmentEvent:"qualifyingTaxableRentalInThirdPeriod",
  taxableRentalConsideration:200000,totalRentalConsideration:2000000,
  taxRule:{...rule,taxYear:2028,adjustmentPeriodReviewed:true}});
 assert.equal(result.eligibleInputVATAdjustment,500000);
 assert.equal(result.qualifyingRentalFraction,.1);
 assert.equal(result.noAutomaticRefund,true);
});
test("Missing adjustment timing and nonrental disposal formula cannot be guessed",()=>{
 const start={assetId:"apart",restrictedAcquisitionVAT:5000000,adjustmentTaxYear:2028,
  taxableRentalConsideration:100000,totalRentalConsideration:1000000,
  taxRule:{...rule,taxYear:2028}};
 const unknown=assessResidentialRentalVATAdjustment({...start,eligibility:"unknown",
  adjustmentEvent:"qualifyingTaxableRentalInThirdPeriod"});
 assert.equal(unknown.status,"incomplete");
 const sale=assessResidentialRentalVATAdjustment({...start,eligibility:"reviewedEligible",adjustmentEvent:"disposal"});
 assert.equal(sale.status,"incomplete");
 assert.throws(()=>assessResidentialRentalVATAdjustment({...start,eligibility:"reviewedEligible",
  adjustmentEvent:"qualifyingTaxableRentalInThirdPeriod"}));
 assert.throws(()=>assessResidentialRentalVATAdjustment({...start,eligibility:"reviewedEligible",
  adjustmentEvent:"qualifyingTaxableRentalInThirdPeriod",
  taxableRentalConsideration:1100000,taxRule:{...rule,taxYear:2028,adjustmentPeriodReviewed:true}}));
});
