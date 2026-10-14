/**
 * Gate B B4: VAT acquisition input credit restrictions and later adjustments.
 *
 * Legal references include NTA:
 * https://www.nta.go.jp/law/shitsugi/shohi/19/22.htm
 * https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6451.htm
 *
 * These are scenario-rule guards. A user-supplied reviewed classification
 * is not independent confirmation of a statutory right. No positive refund
 * or VAT settlement is emitted from this module.
 */
const num=(x,k,{min=0,max=Infinity}={})=>{
 if(typeof x!=="number"||!Number.isFinite(x)||x<min||x>max)
   throw new RangeError(k+" must be finite and within bounds");
 return x;
};
const required=(s,k)=>{if(typeof s!=="string"||!s)throw new TypeError(k+" required");return s;};
const rule=(r)=>{
 if(!r||!Number.isInteger(r.taxYear)||r.taxYear<1900||
   !r.ruleVersion||typeof r.ruleVersion!=="string"||
   !r.sourceUrl?.startsWith("https://"))throw new RangeError("versioned tax rule/source required");
 if(!["assumption","reviewedScenario"].includes(r.eligibilityBasis))
   throw new RangeError("eligibilityBasis must be explicit");
 return {taxYear:r.taxYear,ruleVersion:r.ruleVersion,sourceUrl:r.sourceUrl,
   eligibilityBasis:r.eligibilityBasis};
};
/**
 * VAT on an acquisition is economically paid even when its input credit is
 * disallowed. This classification is specific to the particular acquisition.
 */
export function classifyAcquisitionInputVAT({
 assetId,propertyUse,inputVAT,taxpayerVATStatus,taxMethod,
 inputCreditClassification,taxRule
}){
 required(assetId,"assetId");
 if(!["residentialRentalBuilding","otherCapitalAsset"].includes(propertyUse))
   throw new RangeError("property use must be explicitly classified");
 num(inputVAT,"inputVAT");
 if(!["taxable","exempt"].includes(taxpayerVATStatus))throw new RangeError("taxpayer VAT status missing");
 if(!["general","simplified"].includes(taxMethod))throw new RangeError("VAT method missing");
 const ruleMeta=rule(taxRule);
 if(taxpayerVATStatus==="exempt")return {assetId,propertyUse,inputVAT,
   immediateCredit:0,restrictedVAT:inputVAT,status:"estimated",rule:ruleMeta,
   note:"Tax-exempt taxpayer has no input-credit refund in this scenario"};
 if(taxMethod==="simplified")return {assetId,propertyUse,inputVAT,
   immediateCredit:null,restrictedVAT:null,status:"incomplete",rule:ruleMeta,
   note:"Invoice-specific input-credit calculation does not determine simplified-scheme credit"};
 if(!["residentialRestricted","reviewedEligible","reviewedIneligible","unknown"].includes(inputCreditClassification))
   throw new RangeError("classification required");
 if(inputCreditClassification==="unknown")return {assetId,propertyUse,inputVAT,
   immediateCredit:null,restrictedVAT:null,status:"incomplete",rule:ruleMeta,
   note:"Input VAT credit eligibility not established; no refund forecast"};
 if(inputCreditClassification==="residentialRestricted"&&propertyUse!=="residentialRentalBuilding")
   throw new RangeError("residential-building restriction classification mismatch");
 if(inputCreditClassification==="residentialRestricted"||inputCreditClassification==="reviewedIneligible")
   return {assetId,propertyUse,inputVAT,immediateCredit:0,restrictedVAT:inputVAT,
    status:"estimated",rule:ruleMeta,note:"Restricted VAT stays in acquisition gross cash; no refund"};
 if(propertyUse==="residentialRentalBuilding"&&taxRule.residentialRestrictionReviewed!==true)
   throw new RangeError("residential rental restriction must be separately reviewed before claim of eligibility");
 return {assetId,propertyUse,inputVAT,immediateCredit:inputVAT,restrictedVAT:0,
   status:"estimated",rule:ruleMeta,note:"Claimed credit is scenario eligibility, not confirmed cash refund"};
}
/**
 * Limited adjustment scenario: retained residential rental building subsequently
 * used for taxable lodging within the legally reviewed adjustment period.
 * Disposal-led adjustment needs a separate formula and is intentionally blocked.
 *
 * Input taxableRentalConsideration is *consideration for qualifying taxable
 * rental use*, NOT a percentage of days booked.
 */
export function assessResidentialRentalVATAdjustment({
 assetId,restrictedAcquisitionVAT,adjustmentTaxYear,eligibility,
 adjustmentEvent,taxableRentalConsideration,totalRentalConsideration,taxRule
}){
 required(assetId,"assetId");
 num(restrictedAcquisitionVAT,"restrictedAcquisitionVAT");
 if(!Number.isInteger(adjustmentTaxYear)||adjustmentTaxYear<1900)throw new RangeError("adjustment tax year");
 const ruleMeta=rule(taxRule);
 if(taxRule.taxYear!==adjustmentTaxYear)throw new RangeError("effective adjustment tax-year rule mismatch");
 if(!["reviewedEligible","reviewedIneligible","unknown"].includes(eligibility))
   throw new RangeError("adjustment applicability must be explicit");
 if(eligibility==="unknown")return {assetId,status:"incomplete",eligibleInputVATAdjustment:null,
   rule:ruleMeta,note:"Unknown later input VAT adjustment: no deemed cash refund"};
 if(eligibility==="reviewedIneligible")return {assetId,status:"estimated",
   eligibleInputVATAdjustment:0,rule:ruleMeta,note:"Reviewed scenario excludes adjustment"};
 if(adjustmentEvent!=="qualifyingTaxableRentalInThirdPeriod")
   return {assetId,status:"incomplete",eligibleInputVATAdjustment:null,rule:ruleMeta,
    note:"Disposition adjustment or unsupported period requires a separate legal formula"};
 num(taxableRentalConsideration,"taxableRentalConsideration");
 num(totalRentalConsideration,"totalRentalConsideration");
 if(totalRentalConsideration===0||taxableRentalConsideration>totalRentalConsideration)
   throw new RangeError("cannot compute adjustment without valid rental consideration denominator");
 if(taxRule.adjustmentPeriodReviewed!==true)
   throw new RangeError("statutory third-period timing not reviewed");
 const proportion=taxableRentalConsideration/totalRentalConsideration;
 const estimate=restrictedAcquisitionVAT*proportion;
 return {assetId,status:"estimated",eligibleInputVATAdjustment:estimate,
   qualifyingRentalFraction:proportion,rule:ruleMeta,
   noAutomaticRefund:true,
   note:"Adds to eligible input tax computation only; actual cash refund is never booked without separate confirmation"};
}
