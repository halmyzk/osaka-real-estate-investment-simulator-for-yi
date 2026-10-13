/**
 * Gate B tax primitives. Financial forecasting, NOT a filing system.
 * All rates use decimals (0.10 = 10%). Yen rounding is explicit and
 * rule-specific. No statutory eligibility is inferred from a model name.
 * Tax assessment and payment schedule are separate from cash ledgers.
 */
const amount=(x,k,{min=-Infinity,max=Infinity}={})=>{
 if(typeof x!=="number"||!Number.isFinite(x)||x<min||x>max)throw new RangeError(k+" must be finite between "+min+" and "+max);
 return x;
};
const nonneg=(x,k)=>amount(x,k,{min:0});
const ratio=(x,k)=>amount(x,k,{min:0,max:1});
const integer=(x,k)=>{amount(x,k);if(!Number.isInteger(x))throw new RangeError(k+" must be integer");return x;};
const validMonth=(x)=>{
 if(typeof x!=="string"||!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(x))throw new RangeError("expected YYYY-MM");
 return x;
};
const plusMonths=(date,months)=>{
 validMonth(date);integer(months,"month offset");
 const [year,m]=date.split("-").map(Number);
 const z=year*12+m-1+months;
 return Math.floor(z/12)+"-"+String(z%12+1).padStart(2,"0");
};
const sum=x=>x.reduce((a,b)=>a+b,0);

/** For display or hypothetical arithmetic: actual tax-rule-specific rounding is separate. */
export function allocateBusinessExpense({expense,method,areaBusiness,areaTotal,actualGuestNights,daysInYear,businessDays,customBusinessShare}){
 nonneg(expense,"expense");
 let share;
 switch(method){
 case "direct":share=1;break;
 case "private":share=0;break;
 case "areaGuestNights":
   nonneg(areaBusiness,"areaBusiness");amount(areaTotal,"areaTotal",{min:Number.MIN_VALUE});
   nonneg(actualGuestNights,"actualGuestNights");integer(daysInYear,"daysInYear");
   if(daysInYear<=0||areaBusiness>areaTotal||actualGuestNights>daysInYear)throw new RangeError("allocation operands invalid");
   share=areaBusiness/areaTotal*actualGuestNights/daysInYear;break;
 case "areaBusinessPeriod":
   nonneg(areaBusiness,"areaBusiness");amount(areaTotal,"areaTotal",{min:Number.MIN_VALUE});
   nonneg(businessDays,"businessDays");integer(daysInYear,"daysInYear");
   if(daysInYear<=0||areaBusiness>areaTotal||businessDays>daysInYear)throw new RangeError("allocation operands invalid");
   share=areaBusiness/areaTotal*businessDays/daysInYear;break;
 case "custom":
   share=ratio(customBusinessShare,"customBusinessShare");break;
 default:throw new RangeError("expense allocation method must be explicit");
 }
 return {amount:expense*share,share,method,status:"computed"};
}

/** Independent statutory-rate input, not a determination of lawful useful life. */
export function depreciateAssetYear({
 category,method,openingTaxBookValue,acquisitionTaxBasis,annualRate,
 inServiceMonths,businessUseShare, minimumClosingBookValue=0,
 nonBusinessBookValueReduction=0
}){
 const allowed=["building","buildingEquipment","leaseholdImprovement","furniture","appliance","other","land"];
 if(!allowed.includes(category))throw new RangeError("asset category unsupported");
 const opening=nonneg(openingTaxBookValue,"openingTaxBookValue");
 nonneg(acquisitionTaxBasis,"acquisitionTaxBasis");
 const share=ratio(businessUseShare,"businessUseShare");
 integer(inServiceMonths,"inServiceMonths");
 if(inServiceMonths<0||inServiceMonths>12)throw new RangeError("months must be 0..12");
 nonneg(minimumClosingBookValue,"minimumClosingBookValue");
 nonneg(nonBusinessBookValueReduction,"nonBusinessBookValueReduction");
 if(minimumClosingBookValue>opening)throw new RangeError("minimum book value exceeds opening");
 if(category==="land"||method==="nonDepreciable"){
   if(category!=="land"&&method!=="nonDepreciable")throw new RangeError("unsupported");
   return {deductibleDepreciation:0,grossBookReduction:0,closingTaxBookValue:opening,status:"computed"};
 }
 if(method!=="straightLine")throw new RangeError("unsupported depreciation method: provide verified schedule instead");
 const rate=ratio(annualRate,"annualRate");
 const capacity=opening-minimumClosingBookValue;
 if(nonBusinessBookValueReduction>capacity)throw new RangeError("non-business adjustment exceeds capacity");
 const gross=Math.min(capacity-nonBusinessBookValueReduction,acquisitionTaxBasis*rate*inServiceMonths/12);
 const deductible=gross*share;
 const reduction=gross+nonBusinessBookValueReduction;
 return {deductibleDepreciation:deductible,grossBookReduction:reduction,closingTaxBookValue:opening-reduction,status:"estimated",note:"Method and rate must be independently checked for eligibility; personal non-business disposal basis requires separate statutory computation"};
}
export function officerHousingBenefit({
 classification,actualOfficerRent,buildingFixedTaxBase,landFixedTaxBase,
 floorAreaSqm,normalMonthlyRent,leasePaidMonthlyRent,ordinaryOwnedRentEquivalent,
 dayFraction=1
}){
 nonneg(actualOfficerRent,"actualOfficerRent");
 ratio(dayFraction,"dayFraction");
 let equivalent;
 if(classification==="small"){
   equivalent=nonneg(buildingFixedTaxBase,"buildingFixedTaxBase")*.002+
      12*nonneg(floorAreaSqm,"floorAreaSqm")/3.3+
      nonneg(landFixedTaxBase,"landFixedTaxBase")*.0022;
 }else if(classification==="ordinaryOwned"){
   equivalent=nonneg(ordinaryOwnedRentEquivalent,"ordinaryOwnedRentEquivalent");
 }else if(classification==="ordinaryLeased"){
   equivalent=Math.max(nonneg(ordinaryOwnedRentEquivalent,"ordinaryRentEquivalent"),
     nonneg(leasePaidMonthlyRent,"leasePaidMonthlyRent")*.5);
 }else if(classification==="luxury"){
   equivalent=nonneg(normalMonthlyRent,"normalMonthlyRent");
 }else throw new RangeError("housing classification unresolved");
 const prorated=equivalent*dayFraction;
 return {rentEquivalent:equivalent,proratedEquivalent:prorated,taxableOfficerBenefit:Math.max(0,prorated-actualOfficerRent),
   status:"estimated",notes:["Housing-class eligibility is externally determined","Partial-month proration is a modeling assumption","Corporate deductibility not inferred"]};
}
const PERSONAL_BRACKETS=[
 [1950000,.05,0],[3300000,.10,97500],[6950000,.20,427500],[9000000,.23,636000],
 [18000000,.33,1536000],[40000000,.40,2796000],[Infinity,.45,4796000]
];
/** Taxable income must already include applicable deductions, offsets and statutory base rounding. */
export function nationalPersonalIncomeTax({taxYear,taxableIncome,brackets=PERSONAL_BRACKETS,baseRounding=1000}){
 integer(taxYear,"taxYear");nonneg(taxableIncome,"taxableIncome");
 if(baseRounding!==1&&baseRounding!==1000)throw new RangeError("baseRounding unsupported");
 if(!Array.isArray(brackets)||!brackets.length)throw new TypeError("brackets required");
 const base=Math.floor(taxableIncome/baseRounding)*baseRounding;
 const b=brackets.find(x=>base<x[0]);
 if(!b)throw new RangeError("invalid personal brackets");
 const national=Math.max(0,base*b[1]-b[2]);
 // Separate 2026 and 2027+ surtax labels, even though aggregate is 2.1%.
 const surcharges=taxYear<=2026?{reconstruction: national*.021,defenseIncome:0}:
     {reconstruction:national*.011,defenseIncome:national*.01};
 return {taxYear,taxableBase:base,nationalIncomeTax:national,surcharges,
 totalNationalTax:national+surcharges.reconstruction+surcharges.defenseIncome,
 status:"estimated",notes:"Tax credits and statutory settlement rounding must be applied separately"};
}
/**
 * Small eligible company provisional rate only.
 * Local corporate taxes must be separately supplied, never assumed zero.
 */
export function corporateNationalTax({taxYear,taxableIncome,eligibleSmallCompany,smallBandRate=.15,
 standardRate=.232,smallBandAmount=8000000,defenseCorporateApplies=false,
 defenseAllowance=5000000}){
 integer(taxYear,"taxYear");nonneg(taxableIncome,"taxableIncome");
 if(typeof eligibleSmallCompany!=="boolean")throw new TypeError("eligibleSmallCompany must be explicit");
 ratio(smallBandRate,"smallBandRate");ratio(standardRate,"standardRate");
 nonneg(smallBandAmount,"smallBandAmount");nonneg(defenseAllowance,"defenseAllowance");
 const low=eligibleSmallCompany?Math.min(taxableIncome,smallBandAmount):0;
 const standard=low*smallBandRate+(taxableIncome-low)*standardRate;
 const defense=defenseCorporateApplies?Math.max(0,standard-defenseAllowance)*.04:0;
 return {taxYear,corporateNationalTax:standard,defenseCorporateTax:defense,
    localCorporateTax:"unknown",corporateTaxTotalExcludingLocal:standard+defense,
    status:"estimated",notes:"Corporate eligibility, year-start date, local rates, tax credits and rounding must be provided"};
}
/** Taxable lodging and exempt residential rental are separate. Input VAT cannot be presumed recoverable. */
export function consumptionTax({
 status,mode,outputVAT,inputVAT,eligibleInputVAT,simplifiedTaxableSales,
 deemedPurchaseRate,allowRefund=false
}){
 if(status==="exempt")return {netVAT:0,refund:0,status:"computed",note:"Exempt taxpayer; no input VAT refund"};
 if(status!=="taxable")throw new RangeError("taxpayer consumption status unresolved");
 const output=nonneg(outputVAT,"outputVAT");
 let deductible;
 if(mode==="general"){
   nonneg(inputVAT,"inputVAT");
   deductible=nonneg(eligibleInputVAT,"eligibleInputVAT");
   if(deductible>inputVAT+1e-8)throw new RangeError("eligible input VAT exceeds input VAT");
 }else if(mode==="simplified"){
   nonneg(simplifiedTaxableSales,"simplifiedTaxableSales");
   deductible=output*ratio(deemedPurchaseRate,"deemedPurchaseRate");
 }else throw new RangeError("VAT scheme unresolved");
 const net=output-deductible;
 if(net<0&&!allowRefund)return {netVAT:"unknown",refund:"unknown",status:"incomplete",reason:"Refund eligibility not independently established"};
 return {netVAT:net,refund:Math.max(0,-net),payment:Math.max(0,net),status:"estimated",
   notes:"Input VAT credit eligibility and indirect-tax cash receipt accounting require reconciliation"};
}
export function landBuildingSaleGain({
 ownerType,purchaseDate,saleDate,proceeds,sellingCosts,
 adjustedLandBasis,adjustedBuildingBasis,eligibleSpecialDeduction=0,
 specialDeductionEligibilityConfirmed=false
}){
 if(!["individual","corporation"].includes(ownerType))throw new RangeError("owner type");
 if(typeof purchaseDate!=="string"||typeof saleDate!=="string"||
    !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)||!/^\d{4}-\d{2}-\d{2}$/.test(saleDate))
    throw new RangeError("date format");
 const p=new Date(purchaseDate+"T00:00:00Z"),s=new Date(saleDate+"T00:00:00Z");
 if(!Number.isFinite(p.getTime())||!Number.isFinite(s.getTime())||p>=s)throw new RangeError("sale must postdate purchase");
 nonneg(proceeds,"proceeds");nonneg(sellingCosts,"sellingCosts");
 nonneg(adjustedLandBasis,"adjustedLandBasis");nonneg(adjustedBuildingBasis,"adjustedBuildingBasis");
 nonneg(eligibleSpecialDeduction,"eligibleSpecialDeduction");
 if(eligibleSpecialDeduction>0&&!specialDeductionEligibilityConfirmed)throw new RangeError("special deduction eligibility unconfirmed");
 const gain=proceeds-sellingCosts-adjustedLandBasis-adjustedBuildingBasis;
 const saleYear=s.getUTCFullYear();
 const atJan1=new Date(Date.UTC(saleYear,0,1));
 const greaterThanFiveYears=atJan1>new Date(Date.UTC(p.getUTCFullYear()+5,p.getUTCMonth(),p.getUTCDate()));
 return {ownerType,saleYear,gain,taxableGain:Math.max(0,gain-eligibleSpecialDeduction),
    holdingClass:ownerType==="individual"?(greaterThanFiveYears?"long":"short"):"corporateIncome",
    status:"estimated",notes:"Non-business building depreciation equivalents must already be included in adjusted basis"};
}
/**
 * Category-specific individual income effects; no misc loss offset against salary.
 * Passing exact baseline/eligible other-income amounts is caller responsibility.
 */
export function applyIndividualIncomeCategories({baselineOrdinaryTaxableIncome,projectCategories,
 eligibleRealEstateLossOffset=false,eligibleBusinessLossOffset=false}){
 nonneg(baselineOrdinaryTaxableIncome,"baselineOrdinaryTaxableIncome");
 if(!Array.isArray(projectCategories))throw new TypeError("projectCategories required");
 let offset=0,unoffsetLoss=0;
 for(const x of projectCategories){
   amount(x.amount,"category amount");
   if(!["business","realEstate","miscellaneous"].includes(x.category))throw new RangeError("unrecognized income category");
   if(x.amount>=0){if(x.category!=="miscellaneous")offset+=x.amount;
     else offset+=x.amount; /* positive misc income is taxable; losses within category handled elsewhere */
   }else if((x.category==="realEstate"&&eligibleRealEstateLossOffset)||(x.category==="business"&&eligibleBusinessLossOffset)){
     offset+=x.amount;
   }else unoffsetLoss+=-x.amount;
 }
 return {adjustedTaxableIncome:Math.max(0,baselineOrdinaryTaxableIncome+offset),
    unappliedLoss:unoffsetLoss,status:"estimated",
    notes:"Deduction ordering, intra-category miscellaneous aggregation and statutory offset restrictions require category-specific detail"};
}

/**
 * An annual assessment is not an actual tax payment. This planner allocates
 * *estimated* payments to months, with overrideable dates. Its events must be
 * confirmed or explicitly accepted as projection assumptions before they are
 * booked into forecast cash flow.
 *
 * Periodicity is an illustrative default schedule, not a statutory due-date
 * certification; assess case-specific extension, prepayment and local rules.
 */
export function planTaxPayments({entityId,entityType,taxYear,fiscalYearEndMonth=12,assessments,
   residenceTaxMonths=null,corporateTaxDelayMonths=2}){
 if(typeof entityId!=="string"||!entityId)throw new TypeError("entityId required");
 if(!["individual","corporation"].includes(entityType))throw new RangeError("entityType");
 integer(taxYear,"taxYear");
 integer(fiscalYearEndMonth,"fiscalYearEndMonth");
 if(fiscalYearEndMonth<1||fiscalYearEndMonth>12)throw new RangeError("fiscalYearEndMonth range");
 integer(corporateTaxDelayMonths,"corporateTaxDelayMonths");
 if(corporateTaxDelayMonths<0)throw new RangeError("corporateTaxDelayMonths negative");
 if(!Array.isArray(assessments))throw new TypeError("assessments array required");
 const entries=[],seen=new Set();
 const yearMonth=(y,m)=>y+"-"+String(m).padStart(2,"0");
 for(const a of assessments){
   if(typeof a.id!=="string"||!a.id||seen.has(a.id))throw new RangeError("unique assessment id required");
   seen.add(a.id);
   const value=amount(a.amount,"assessed amount");
   if(value<0&&a.refundConfirmed!==true)throw new RangeError("Unconfirmed tax refund not scheduled");
   if(!["incomeTax","residenceTax","corporateTax","consumptionTax","saleGainTax","otherTax"].includes(a.taxKind))
     throw new RangeError("tax kind invalid");
   let months;
   if(a.paymentMonths!==undefined){
     if(!Array.isArray(a.paymentMonths)||a.paymentMonths.length===0)throw new TypeError("paymentMonths must be nonempty array");
     months=a.paymentMonths.map(validMonth);
   }else if(entityType==="individual"){
     if(a.taxKind==="incomeTax"||a.taxKind==="saleGainTax"||a.taxKind==="consumptionTax")months=[yearMonth(taxYear+1,3)];
     else if(a.taxKind==="residenceTax"){
       months=residenceTaxMonths??[yearMonth(taxYear+1,6),yearMonth(taxYear+1,8),yearMonth(taxYear+1,10),yearMonth(taxYear+2,1)];
       if(!Array.isArray(months)||months.length!==4)throw new RangeError("resident tax schedule requires four payments");
       months=months.map(validMonth);
     }else throw new RangeError("individual tax payment month must be explicitly configured");
   }else if(["corporateTax","consumptionTax"].includes(a.taxKind)){
     months=[plusMonths(yearMonth(taxYear,fiscalYearEndMonth),corporateTaxDelayMonths)];
   }else throw new RangeError("corporate local or special tax needs explicitly configured payment months");
   const weights=a.paymentWeights??Array(months.length).fill(1/months.length);
   if(!Array.isArray(weights)||weights.length!==months.length)throw new RangeError("payment weights count mismatch");
   weights.forEach((w,i)=>ratio(w,"paymentWeights["+i+"]"));
   if(Math.abs(sum(weights)-1)>1e-9)throw new RangeError("payment weights must total one");
   months.forEach((month,i)=>entries.push({id:a.id+"-payment-"+i,entityId,month,taxYear,
      taxKind:a.taxKind,amount:value*weights[i],refundConfirmed:value<0&&a.refundConfirmed===true,
      status:"estimated",assessmentId:a.id}));
 }
 return {entries,status:"estimated",notes:"Forecast schedule only; validate statutory due dates, withholding and interim payments"};
}
/**
 * Cash tax events are explicit. Positive amount is payment, negative is actual
 * refund; only confirmed refunds may enter cash ledger. Use without-project
 * comparator to compute attributable incremental tax at same entity/month.
 */
export function incrementalTaxEvents({withProject,withoutProject}){
 if(!Array.isArray(withProject)||!Array.isArray(withoutProject))throw new TypeError("tax events arrays required");
 const cash=new Map(),keys=new Set();
 const collect=(events,sign,label)=>{
   for(const e of events){
     if(!e||typeof e.entityId!=="string"||!e.entityId)throw new TypeError("tax entityId required");
     validMonth(e.month);amount(e.amount,"tax amount");
     if(e.amount<0&&e.refundConfirmed!==true)throw new RangeError("Unconfirmed refund cannot be booked");
     if(!["incomeTax","residenceTax","corporateTax","consumptionTax","saleGainTax","otherTax"].includes(e.taxKind))throw new RangeError("taxKind");
     const uniqueness=label+"|"+e.entityId+"|"+e.month+"|"+e.taxKind+"|"+String(e.id);
     if(!e.id||keys.has(uniqueness))throw new RangeError("duplicate tax event id");
     keys.add(uniqueness);
     const key=e.entityId+"|"+e.month+"|"+e.taxKind;
     const item=cash.get(key)??{entityId:e.entityId,month:e.month,taxKind:e.taxKind,withAmount:0,withoutAmount:0};
     item[label]+=sign*e.amount;cash.set(key,item);
   }
 };
 collect(withProject,1,"withAmount");collect(withoutProject,1,"withoutAmount");
 const entries=[...cash.values()].map(x=>({...x,incrementalPaid:x.withAmount-x.withoutAmount,
   incrementalTaxCF:-(x.withAmount-x.withoutAmount)})).sort((a,b)=>a.month.localeCompare(b.month)||a.entityId.localeCompare(b.entityId));
 return {entries,incrementalTaxCF:sum(entries.map(x=>x.incrementalTaxCF)),status:"computed"};
}
/** Reconcile tax cash with pre-tax ledger; include taxes paid after asset sale. */
export function applyTaxToPretaxLedger(pretaxLedger,taxEvents){
 if(!pretaxLedger?.series||!Array.isArray(taxEvents?.entries))throw new TypeError("ledger and tax events required");
 const m=new Map(pretaxLedger.series.map(x=>[x.month,{...x,taxCashFlow:0}]));
 for(const tax of taxEvents.entries){
   if(!m.has(tax.month))m.set(tax.month,{month:tax.month,operating:0,investing:0,financing:0,pretaxEquityCF:0,taxCashFlow:0});
   m.get(tax.month).taxCashFlow+=tax.incrementalTaxCF;
 }
 const series=[...m.values()].sort((a,b)=>a.month.localeCompare(b.month)).map(x=>({
   ...x,afterTaxEquityCF:x.pretaxEquityCF+x.taxCashFlow
 }));
 const totalPreTax=sum(series.map(x=>x.pretaxEquityCF));
 const totalTax=sum(series.map(x=>x.taxCashFlow));
 return {series,totals:{pretaxEquityCF:totalPreTax,incrementalTaxCashFlow:totalTax,
   afterTaxEquityCF:totalPreTax+totalTax},status:"estimated",
   notes:"No cross-entity tax netting; VAT-inclusive business receipts must separately reconcile"};
}
