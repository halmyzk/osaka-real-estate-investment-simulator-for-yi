import test from "node:test";
import assert from "node:assert/strict";
import {assessOfficerResidenceException,screenOfficerEconomicBenefitDeductibility} from "../src/officer-housing-exceptions.mjs";
const NTA="https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2600.htm";
const common={corporationId:"corp",officerId:"person",month:"2026-06",
 arrangementEvidenceUrl:NTA};
const cashProof={corporationId:"corp",month:"2026-06",amount:50000,cashAlreadyInLedger:true};
test("NTA No.2600 cash housing allowance: cash salary, not duplicated as imputed company-housing cash",()=>{
 const x=assessOfficerResidenceException({...common,
  arrangement:{kind:"cashHousingAllowance",contractTenant:"person",employerHousingPayment:50000},
  payrollCashProof:cashProof});
 assert.equal(x.taxableHousingBenefit,0);
 assert.equal(x.additionalSalaryForTax,50000);
 assert.equal(x.newOperatingCash,0);
 const included=assessOfficerResidenceException({...common,
  arrangement:{kind:"cashHousingAllowance",contractTenant:"person",employerHousingPayment:50000},
  payrollCashProof:cashProof,personalSalaryBaselineIncludesPayment:true});
 assert.equal(included.additionalSalaryForTax,0);
});
test("NTA No.2600 officer-direct lease is not treated as employer-leased company housing",()=>{
 const x=assessOfficerResidenceException({...common,
  arrangement:{kind:"officerDirectLease",contractTenant:"person",employerHousingPayment:50000},
  payrollCashProof:cashProof});
 assert.equal(x.additionalSalaryForTax,50000);
 assert.throws(()=>assessOfficerResidenceException({...common,
  arrangement:{kind:"officerDirectLease",contractTenant:"corp",employerHousingPayment:50000},
  payrollCashProof:cashProof}));
});
test("No evidence of a real cash allowance means no economic payment is created",()=>{
 assert.throws(()=>assessOfficerResidenceException({...common,
  arrangement:{kind:"cashHousingAllowance",contractTenant:"person",employerHousingPayment:50000}}));
 assert.throws(()=>assessOfficerResidenceException({...common,
  arrangement:{kind:"cashHousingAllowance",contractTenant:"person",employerHousingPayment:50000},
  payrollCashProof:{...cashProof,cashAlreadyInLedger:false}}));
});
const housing={corporationId:"corp",officerId:"person",month:"2026-06",
 classification:"small",companyTenure:"owned",
 buildingUsefulLifeYears:35,totalFloorAreaSqm:99,
 buildingFixedTaxBase:2000000,landFixedTaxBase:5000000,
 officerRentPaid:0,excludedLuxuryStatus:"reviewedNotLuxury",
 classificationEvidenceUrl:NTA,corporateExpenseTreatment:"notBooked",
 bookedOfficerBenefitExpense:0};
test("Company-provided housing needs reviewed classification and extraordinary amenities consideration",()=>{
 const args={...common,arrangement:{kind:"corporateHousing",contractTenant:"corp"},
  monthlyHousing:housing};
 assert.equal(assessOfficerResidenceException(args).status,"incomplete");
 assert.equal(assessOfficerResidenceException({...args,reviewedLuxuryClassification:"reviewedNotLuxury",
  specialAmenitiesPresent:true}).status,"incomplete");
 const allowed=assessOfficerResidenceException({...args,reviewedLuxuryClassification:"reviewedNotLuxury"});
 assert.equal(allowed.taxableHousingBenefit,15360);
 assert.equal(allowed.newOperatingCash,0);
});
const months=Array.from({length:12},(_,i)=>({month:"2026-"+String(i+1).padStart(2,"0"),amount:15360}));
test("NTA No.5202 constant monthly benefits still require separate regularity/high-pay/concealment reviews",()=>{
 const args={corporationId:"corp",year:2026,monthlyBenefits:months};
 const missing=screenOfficerEconomicBenefitDeductibility({...args,
  regularityReviewed:"reviewedRegular",excessiveAmountReviewed:"unknown",concealmentReviewed:"reviewedNoConcealment"});
 assert.equal(missing.status,"incomplete");
 const eligible=screenOfficerEconomicBenefitDeductibility({...args,
  regularityReviewed:"reviewedRegular",excessiveAmountReviewed:"reviewedReasonable",
  concealmentReviewed:"reviewedNoConcealment"});
 assert.equal(eligible.eligibility,"reviewedScenarioDeductible");
 assert.equal(eligible.amount,184320);
 const high=screenOfficerEconomicBenefitDeductibility({...args,
  regularityReviewed:"reviewedRegular",excessiveAmountReviewed:"reviewedExcessive",
  concealmentReviewed:"reviewedNoConcealment"});
 assert.equal(high.eligibility,"reviewedScenarioNondeductible");
});
test("NTA No.5202 claimed regularity contradicting actual monthly amounts is rejected",()=>{
 const args={corporationId:"corp",year:2026,
  monthlyBenefits:months.map((x,i)=>i===11?{...x,amount:50000}:x),
  regularityReviewed:"reviewedRegular",excessiveAmountReviewed:"reviewedReasonable",
  concealmentReviewed:"reviewedNoConcealment"};
 assert.throws(()=>screenOfficerEconomicBenefitDeductibility(args));
});
