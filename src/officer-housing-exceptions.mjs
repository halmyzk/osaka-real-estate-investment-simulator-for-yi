/**
 * B-T12/14 officer housing exception routing; no automatic eligibility.
 * https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2600.htm
 * https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/5202.htm
 *
 * A cash housing allowance / personally leased residence is NOT treated as
 * corporate-provided housing. Its actual salary payment must already be
 * separately present in economic cash; only the incremental salary-tax
 * amount is passed into assessPersonalYear().
 */
import {calculateOfficerHousingTaxMonth} from "./officer-housing-tax.mjs";
const NTA_OFFICER="https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2600.htm";
const NTA_CORPORATE="https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/5202.htm";
const money=(v,k)=>{if(typeof v!=="number"||!Number.isFinite(v)||v<0)throw new RangeError(k+" must be finite nonnegative");return v;};
const person=(v,k)=>{if(typeof v!=="string"||!v)throw new TypeError(k+" required");return v;};
const period=x=>{if(typeof x!=="string"||!/^\d{4}-(0[1-9]|1[0-2])$/.test(x))throw new RangeError("YYYY-MM required");return x;};
export function assessOfficerResidenceException({
 corporationId,officerId,month,arrangement,
 monthlyHousing=null,
 reviewedLuxuryClassification="unknown",
 specialAmenitiesPresent=false,
 payrollCashProof=null,
 personalSalaryBaselineIncludesPayment=false,
 arrangementEvidenceUrl
}){
 person(corporationId,"corporationId");person(officerId,"officerId");period(month);
 if(corporationId===officerId)throw new RangeError("two distinct taxpayers required");
 if(!arrangementEvidenceUrl?.startsWith("https://"))throw new RangeError("arrangement evidence required");
 if(!["corporateHousing","cashHousingAllowance","officerDirectLease"].includes(arrangement?.kind))
   throw new RangeError("arrangement kind must be explicit");
 if(arrangement.kind==="corporateHousing"){
   if(arrangement.contractTenant!==corporationId||monthlyHousing===null||
      !["reviewedLuxury","reviewedNotLuxury"].includes(reviewedLuxuryClassification))
     return {status:"incomplete",reason:"Corporate lease/ownership or luxury status unreviewed",
       taxableHousingBenefit:null};
   if(specialAmenitiesPresent && reviewedLuxuryClassification!=="reviewedLuxury")
     return {status:"incomplete",reason:"Exceptional facilities may make dwelling luxurious",
       taxableHousingBenefit:null};
   if(monthlyHousing.corporationId!==corporationId||
     monthlyHousing.officerId!==officerId||monthlyHousing.month!==month)
      throw new RangeError("monthly officer house belongs to another entity/month");
   if(reviewedLuxuryClassification==="reviewedLuxury"&&monthlyHousing.classification!=="luxury")
     throw new RangeError("luxury review conflicts with tax valuation category");
   if(reviewedLuxuryClassification==="reviewedNotLuxury"&&monthlyHousing.classification==="luxury")
     throw new RangeError("luxury review conflicts with valuation category");
   const val=calculateOfficerHousingTaxMonth({
     ...monthlyHousing,excludedLuxuryStatus:reviewedLuxuryClassification,
     classificationEvidenceUrl:arrangementEvidenceUrl
   });
   if(val.status!=="estimated")return {...val,status:"incomplete"};
   return {status:"estimated",taxpayerOfficerId:officerId,
     taxableHousingBenefit:val.imputedSalaryBenefit,
     additionalSalaryForTax:val.imputedSalaryBenefit,
     newOperatingCash:0,officerMonthlyTaxDetail:val,
     note:"Economic salary is noncash. Actual officer rent has separate mirrored proof"};
 }
 if(reviewedLuxuryClassification!=="unknown"&&reviewedLuxuryClassification!=="notApplicable")
   throw new RangeError("Luxury housing class not relevant to cash allowances or personally leased dwelling");
 if(arrangement.contractTenant!==officerId&&arrangement.kind==="officerDirectLease")
   throw new RangeError("Direct lease must be legally held by officer");
 if(arrangement.kind==="cashHousingAllowance"&&monthlyHousing!==null)
   throw new RangeError("Cash housing allowance is not employer housing");
 const value=money(arrangement.employerHousingPayment,"employerHousingPayment");
 if(!payrollCashProof||payrollCashProof.corporationId!==corporationId||
    payrollCashProof.month!==month||payrollCashProof.amount!==value||
    payrollCashProof.cashAlreadyInLedger!==true)
   throw new RangeError("Actual employer housing payment must already be documented in cash ledger");
 if(typeof personalSalaryBaselineIncludesPayment!=="boolean")
   throw new TypeError("salary baseline inclusion must be explicit");
 return {status:"estimated",taxpayerOfficerId:officerId,arrangementKind:arrangement.kind,
   taxableHousingBenefit:0,additionalSalaryForTax:personalSalaryBaselineIncludesPayment?0:value,
   cashSalaryOrSubsidy:value,newOperatingCash:0,
   note:"NTA 2600 treats cash housing allowance and direct officer lease differently from corporate housing; employer payment already in cash"};
}
/**
 * Monthly regularity alone does not grant corporate deduction. Screen
 * and insist on reviewed Article 34/related officer compensation conditions.
 */
export function screenOfficerEconomicBenefitDeductibility({
 corporationId,year,monthlyBenefits,
 regularityReviewed,excessiveAmountReviewed,concealmentReviewed
}){
 person(corporationId,"corporationId");
 if(!Number.isInteger(year)||year<1900||!Array.isArray(monthlyBenefits)||
    monthlyBenefits.length!==12)throw new RangeError("12-month fiscal-calendar review required");
 const seen=new Set(),amounts=[];
 for(const m of monthlyBenefits){
  period(m.month);
  if(m.month.slice(0,4)!==String(year)||seen.has(m.month))
    throw new RangeError("duplicate/missing fiscal-calendar month");
  seen.add(m.month);amounts.push(money(m.amount,"officer benefit"));
 }
 const allMonths=Array.from({length:12},(_,i)=>year+"-"+String(i+1).padStart(2,"0"));
 if(allMonths.some(x=>!seen.has(x)))throw new RangeError("missing month");
 if(!["reviewedRegular","reviewedIrregular","unknown"].includes(regularityReviewed)||
    !["reviewedReasonable","reviewedExcessive","unknown"].includes(excessiveAmountReviewed)||
    !["reviewedNoConcealment","reviewedConcealment","unknown"].includes(concealmentReviewed))
      throw new RangeError("tax advisor eligibility reviews required");
 const strictlyRegular=amounts.every(x=>Math.abs(x-amounts[0])<=1);
 if(regularityReviewed==="reviewedRegular"&&!strictlyRegular)
   throw new RangeError("claimed constant benefits do not reconcile");
 const allowed=regularityReviewed==="reviewedRegular"&&
   excessiveAmountReviewed==="reviewedReasonable"&&
   concealmentReviewed==="reviewedNoConcealment"&&strictlyRegular;
 const clearlyRejected=regularityReviewed==="reviewedIrregular"||
   excessiveAmountReviewed==="reviewedExcessive"||
   concealmentReviewed==="reviewedConcealment";
 return {corporationId,year,status:allowed||clearlyRejected?"estimated":"incomplete",
   eligibility:allowed?"reviewedScenarioDeductible":clearlyRejected?"reviewedScenarioNondeductible":"unknown",
   amount:amounts.reduce((a,b)=>a+b,0),
   sourceUrl:NTA_CORPORATE,
   note:"Numerical regularity is not itself legal eligibility; exceptions and statutory salary classification require legal review"};
}
