/**
 * Gate B B-T19: mixed personal/business use building at disposal.
 *
 * NTA No.3261 requires building acquisition cost reduced by depreciation
 * equivalents (even where unclaimed as current tax expense).
 * NTA income-tax circular 38-3 permits a nonbusiness treatment where >=90%
 * was nonbusiness throughout ownership; this is an OPTIONAL reviewed basis,
 * not an automatic tax election or entitlement.
 *
 * General simultaneous-use path accepts independently reviewed, complete
 * monthly gross-equivalent reductions rather than inventing a universal
 * statutory area-ratio formula. This is an evidence gate + sum, NOT an
 * automatic legal depreciation calculator.
 */
const acquisitionSource="https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3261.htm";
const circularSource="https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/05/18.htm";
const money=(x,k)=>{if(typeof x!=="number"||!Number.isFinite(x)||x<0)throw new RangeError(k+" must be nonnegative finite");return x;};
const id=(s,k)=>{if(typeof s!=="string"||!s)throw new TypeError(k+" required");return s;};
const ym=s=>{if(typeof s!=="string"||!/^\d{4}-(0[1-9]|1[0-2])$/.test(s))throw new RangeError("month YYYY-MM required");return s;};
const date=(s,k)=>{id(s,k);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new RangeError("date invalid");const d=new Date(s+"T00:00:00Z");if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==s)throw new RangeError("impossible date");return s;};
const enumerate=(start,end)=>{
 const [sy,sm]=ym(start).split("-").map(Number),[ey,em]=ym(end).split("-").map(Number);
 const first=sy*12+sm-1,last=ey*12+em-1;
 if(first>last||last-first>1200)throw new RangeError("month period invalid/too long");
 return Array.from({length:last-first+1},(_,i)=>{const n=first+i;return Math.floor(n/12)+"-"+String(n%12+1).padStart(2,"0")});
};
/**
 * records is one row per OWNED month including first/last partial months:
 * {month, businessShare, privateShare, businessGrossEquivalent,
 *  nonbusinessGrossEquivalent, businessActualDeducted,
 *  evidenceUrl, reviewedDisposalTreatment}
 * Partial-month depreciation is independently prepared and must be reflected
 * in the monetary amounts; we never apply an unreviewed monthly shortcut.
 */
export function reconcileConcurrentUseSaleBasis({
 buildingId,ownerEntityId,acquiredAt,soldAt,acquisitionBasis,
 monthlyRecords,splitCalculationReviewed,ruleVersion,
 dispositionExclusionReviewed
}){
 id(buildingId,"buildingId");id(ownerEntityId,"ownerEntityId");
 const purchased=date(acquiredAt,"acquiredAt"),disposed=date(soldAt,"soldAt");
 if(purchased>=disposed)throw new RangeError("disposed before acquisition");
 const basis=money(acquisitionBasis,"acquisitionBasis");
 if(!Array.isArray(monthlyRecords)||!monthlyRecords.length||splitCalculationReviewed!==true ||
   dispositionExclusionReviewed!==true||!id(ruleVersion,"ruleVersion"))
   throw new RangeError("complete reviewed monthly attribution required");
 const requiredMonths=enumerate(acquiredAt.slice(0,7),soldAt.slice(0,7));
 const m=new Map();
 for(const r of monthlyRecords){
   if(!r||!ym(r.month)||m.has(r.month))throw new RangeError("duplicate/missing month");
   m.set(r.month,r);
   for(const k of ["businessShare","privateShare"])money(r[k],k);
   if(Math.abs(r.businessShare+r.privateShare-1)>1e-9)throw new RangeError("owned month business/private shares must total one");
   for(const k of ["businessGrossEquivalent","nonbusinessGrossEquivalent","businessActualDeducted"])money(r[k],k);
   if(r.businessActualDeducted>r.businessGrossEquivalent+1e-6)
     throw new RangeError("business tax expense larger than depreciation equivalent");
   if(r.reviewedDisposalTreatment!==true||!r.evidenceUrl?.startsWith("https://"))
     throw new RangeError("monthly disposal-basis attribution unverified");
   if(r.businessShare===0 && (r.businessGrossEquivalent!==0||r.businessActualDeducted!==0))
     throw new RangeError("business depreciation in private-only month");
   if(r.privateShare===0 && r.nonbusinessGrossEquivalent!==0)
     throw new RangeError("nonbusiness depreciation in business-only month");
 }
 if(m.size!==requiredMonths.length||requiredMonths.some(x=>!m.has(x)))
   throw new RangeError("missing/acquired-outside/extra owned month");
 const sums={businessEquivalent:0,privateEquivalent:0,businessDeducted:0};
 let allPrivateAtLeast90=true;
 for(const month of requiredMonths){
   const r=m.get(month);
   sums.businessEquivalent+=r.businessGrossEquivalent;
   sums.privateEquivalent+=r.nonbusinessGrossEquivalent;
   sums.businessDeducted+=r.businessActualDeducted;
   allPrivateAtLeast90 &&= r.privateShare>=.9-1e-9;
 }
 if(sums.businessEquivalent+sums.privateEquivalent>basis+1e-6)
   throw new RangeError("overstated cumulative reduction exceeds acquisition cost");
 const adjustedBasis=basis-sums.businessEquivalent-sums.privateEquivalent;
 return {buildingId,ownerEntityId,acquiredAt,soldAt,acquisitionBasis:basis,
   businessBookReduction:sums.businessEquivalent,
   nonbusinessBookReduction:sums.privateEquivalent,
   deductibleBusinessExpenseHistory:sums.businessDeducted,
   nonDeductedBusinessReduction:sums.businessEquivalent-sums.businessDeducted,
   adjustedBuildingBasis:adjustedBasis,allPrivateAtLeast90,months:requiredMonths.length,
   status:"estimated",method:"independentlyReviewedConcurrentMonthlyReductions",
   sourceUrls:[acquisitionSource,circularSource],
   note:"No automatic month-by-month statutory depreciation amount, private-use half-year rounding, or personal deduction inferred"};
}
/** A separate reviewed treatment, NOT a consequence of passing >=90% alone. */
export function screenNonBusiness90PercentTreatment({monthlyRecords,electedTreatment,legalReview}){
 if(!Array.isArray(monthlyRecords)||!monthlyRecords.length)throw new TypeError("monthly history required");
 const ruleMet=monthlyRecords.every(r=>typeof r?.privateShare==="number"&&
   Number.isFinite(r.privateShare)&&r.privateShare>=.9&&r.privateShare<=1);
 const selected=electedTreatment===true;
 const evidence=legalReview?.sourceUrl===circularSource&&
   legalReview?.reviewedForOwnershipEntirePeriod===true&&
   legalReview?.applicabilityReviewed===true;
 return {status:!ruleMet||!selected||!evidence?"incomplete":"estimated",
   qualifiesUnderReviewedScenario:ruleMet&&selected&&evidence,
   totalNonbusinessShareCondition:ruleMet,sourceUrl:circularSource,
   note:"If elected, full nonbusiness disposal-basis computation must be calculated separately; this function never overwrites business ledger amounts"};
}
