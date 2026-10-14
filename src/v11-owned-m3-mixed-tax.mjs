/**
 * Gate B M3, individual-owned residential + short-stay mixed use:
 * checked calendar -> independently evidenced guest-night/area allocation ->
 * ordinary lodging miscellaneous income/depreciation ->
 * independently REVIEWED private/business disposal reductions -> sale tax.
 *
 * NO automatic legal private-use depreciation equivalents: the sale basis is
 * accepted ONLY as a complete reviewed MONTHLY evidence schedule through
 * reconcileConcurrentUseSaleBasis.  Do not use 180 lodging allocation days
 * as actual nights OR building business-in-service days.
 *
 * Restricted: January 1 newly acquired/opened, December 31 exit, exactly
 * land + building, full annual coverage, all occupied area reviewed and no
 * renovation/additional assets/closing capital charges/VAT/residential relief.
 */
import {allocateBusinessExpense} from "./tax.mjs";
import {depreciateAssetTimeline} from "./tax-rules.mjs";
import {reconcileConcurrentUseSaleBasis} from "./mixed-use-sale-basis.mjs";
import {landBuildingSaleGain} from "./tax.mjs";
import {individualSaleGainTax} from "./tax-detail.mjs";

const URLS=Object.freeze({
  basis:"https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3261.htm",
  use:"https://www.nta.go.jp/law/joho-zeikaishaku/shotoku/shinkoku/0018005-115/0018005-115.pdf",
  depreciation:"https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2100.htm",
  short:"https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3211.htm",
  long:"https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3208.htm"
});
export const m3MixedTaxSources=URLS;
const finite=(v,k,{min=0,max=Infinity}={})=>{
 if(typeof v!=="number"||!Number.isFinite(v)||v<min||v>max)
   throw new RangeError(k+" requires an explicit finite number");
 return v;
};
const txt=(v,k)=>{if(typeof v!=="string"||!v)throw new TypeError(k+" required");return v};
const equal=(a,b)=>Math.abs(a-b)<=Math.max(1e-6,Math.abs(b)*1e-9);
const iso=s=>{txt(s,"date");const d=new Date(s+"T00:00:00Z");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(+d)||d.toISOString().slice(0,10)!==s)
   throw new RangeError("ISO date required");return s;};
const yearDays=y=>(new Date(Date.UTC(y+1,0,1))-new Date(Date.UTC(y,0,1)))/86400000;
const monthsOf=(year)=>Array.from({length:12},(_,i)=>year+"-"+String(i+1).padStart(2,"0"));
const sum=xs=>xs.reduce((a,b)=>a+b,0);
const checkEvidence=r=>r?.reviewStatus==="reviewedScenarioAssumption"&&
    typeof r.sourceUrl==="string"&&r.sourceUrl.startsWith("https://");

export function deriveOwnedM3MixedTaxRegister({
 unit,unitResult,ownerType,ownedReview,unitYearReviews
}){
 if(unit?.tenure!=="own"||unit?.modelId!=="M3"||
    ownerType!=="individual"||unitResult?.status!=="computed"||
    unitResult.entityId!==unit.ownerEntityId||
    unit.ownerEntityId!==unit.operatorEntityId||
    unit.tenantEntityId!==null&&unit.tenantEntityId!==undefined)
   throw new RangeError("Mixed-use pilot requires single-owner individual owned M3 with completed operations");
 if(!ownedReview||ownedReview.unitId!==unit.id||
    ownedReview.reviewStatus!=="reviewedScenarioAssumption"||
    ownedReview.reviewedTaxBasis!==true||
    !ownedReview.costAllocationSourceUrl?.startsWith("https://"))
    throw new RangeError("M3 asset/tax basis needs reviewed land/building allocation");
 const start=iso(unit.startDate),open=iso(unit.operationStartDate),exit=iso(unit.exit.exitDate);
 if(start!==open||start.slice(5)!=="01-01"||exit.slice(5)!=="12-31"||!(start<exit))
    throw new RangeError("M3 pilot requires Jan-1 acquisition and use and Dec-31 sale");
 if(unit.exit.method!=="priceGrowth"||unit.exit.applyResidentialRelief!==false)
    throw new RangeError("M3 sale relief and non-price exit require separate qualification");
 const years=Array.from({length:Number(exit.slice(0,4))-Number(start.slice(0,4))+1},
   (_,i)=>Number(start.slice(0,4))+i);
 if(!years.length||years.length>40||unitResult.operating.length!==years.length*12)
    throw new RangeError("M3 requires continuous 12-month business/owner coverage");
 const yearsMap=new Map(),operatingMonths=new Map();
 for(const o of unitResult.operating){
   if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(o.month)||
      operatingMonths.has(o.month)||o.result.status!=="computed"||
      o.result.modelId!=="M3")
     throw new RangeError("Duplicate or incomplete M3 monthly operating results");
   operatingMonths.set(o.month,o.result);
 }
 const calendar=new Map();
 for(const entry of unit.calendar){
   const m=entry.year+"-"+String(entry.month).padStart(2,"0");
   if(calendar.has(m))throw new RangeError("Duplicate M3 calendar month");
   calendar.set(m,entry);
 }
 for(const y of years)for(const mo of monthsOf(y)){
   const c=calendar.get(mo),o=operatingMonths.get(mo);
   if(!o||!c||o.lodging.allocatedDays!==c.lodgingDays||
      o.rental.allocatedDays!==0||c.rentalDays!==0||c.selfUseDays<=0||
      c.lodgingDays<0||c.lodgingDays>o.calendarDays)
      throw new RangeError("M3 requires individually reviewed lodging/private calendar and no rental stream");
 }
 if(calendar.size!==operatingMonths.size)
    throw new RangeError("M3 use calendar must exactly cover all model months");
 const reviews=ownedReview.yearUseReviews;
 if(!Array.isArray(reviews)||reviews.length!==years.length||
    !Array.isArray(unitYearReviews)||unitYearReviews.length!==years.length)
    throw new RangeError("Separate annual use and ordinary-tax reviews required for each tax year");
 const annualReviews=new Map(),ordinaryReviews=new Map();
 for(const r of reviews){
   if(!years.includes(r?.taxYear)||annualReviews.has(r.taxYear)||!checkEvidence(r))
     throw new RangeError("Year use review invalid/duplicate/missing evidence");
   annualReviews.set(r.taxYear,r);
 }
 for(const r of unitYearReviews){
   if(!years.includes(r?.taxYear)||ordinaryReviews.has(r.taxYear))
     throw new RangeError("Ordinary-tax year classification duplicates or omissions");
   ordinaryReviews.set(r.taxYear,r);
 }
 for(const y of years)if(!annualReviews.has(y)||!ordinaryReviews.has(y))
    throw new RangeError("M3 missing reviewed use or ordinary income tax year");
 if((unit.fields?.A?.A05?.value??0)!==0)
   throw new RangeError("M3 property holding expense A05 is not automatically a utility allocation");
 if((unit.expenses??[]).some(e=>
      e.category!=="propertyOperating"||
      e.allocationMethod!=="areaTimesGuestNights"||
      e.taxTreatment!=="deductible"||
      e.businessUseRatio!==undefined&&e.businessUseRatio!==100))
   throw new RangeError("M3 pilot accepts only independently reviewed shared utility expenses; other cost attribution must be classified separately");
 if(unitResult.investing.some(e=>
      !["acquisitionPrice","disposalProceeds","saleCosts"].includes(e.category)&&e.amount!==0))
   throw new RangeError("M3 investment fee, capital work, sale liability or extra asset tax adjustment needs own reviewed ledger");
 if((unit.loans??[]).some(l=>(l.fees??0)!==0))
   throw new RangeError("M3 loan finance fee tax basis requires separate review");
 const purchases=unitResult.investing.filter(e=>e.category==="acquisitionPrice");
 const sales=unitResult.investing.filter(e=>e.category==="disposalProceeds");
 if(purchases.length!==1||sales.length!==1||
    purchases[0].month!==start.slice(0,7)||sales[0].month!==exit.slice(0,7))
   throw new RangeError("M3 acquisition/sale must each appear once at reviewed months");
 const acquisition=finite(-purchases[0].amount,"property purchase cash");
 const gross=finite(sales[0].amount,"property sale cash");
 const sellingCosts=sum(unitResult.investing.filter(e=>e.category==="saleCosts")
   .map(e=>finite(-e.amount,"selling cost")));
 const saleReview=ownedReview.saleReview;
 if(saleReview?.reviewStatus!=="reviewedScenarioAssumption"||
    saleReview.eligibleRelief!==false||saleReview.saleProceedsMatchCash!==true||
    saleReview.exitCostsDeductibleReviewed!==true||
    !saleReview.salePriceSourceUrl?.startsWith("https://")||
    !equal(finite(saleReview.grossPriceReviewed,"reviewed proceeds"),gross)||
    !equal(finite(saleReview.sellingCostsReviewed,"reviewed selling costs"),sellingCosts))
   throw new RangeError("M3 sale costs/price and no-relief assumption require independent review");
 const assets=unit.assets??[];
 if(assets.length!==2||!assets.some(a=>a.category==="building")||
    !assets.some(a=>a.category==="land")||new Set(assets.map(a=>a.category)).size!==2)
    throw new RangeError("M3 pilot requires one land and one building and no unclassified additional assets");
 const land=assets.find(a=>a.category==="land"),building=assets.find(a=>a.category==="building");
 for(const a of assets){
   if(a.ownerEntityId!==unit.ownerEntityId||iso(a.invoiceDate)!==start||
      iso(a.inServiceDate)!==start||iso(a.disposalDate)!==exit||
      !equal(finite(a.grossCost,"asset gross"),finite(a.taxBasis,"asset basis"))||
      !equal(finite(a.taxBookValue,"initial book"),a.taxBasis)||
      finite(a.priorAccumulatedDepreciation??0,"prior depreciation")!==0)
      throw new RangeError("M3 purchased asset basis/dates/owner require item-level review");
   const actualRatio=new Map();
   for(const rr of a.businessUseRatioByYear??[]){
     if(!years.includes(rr.year)||actualRatio.has(rr.year))
       throw new RangeError("M3 annual asset use ratios duplicated/missing");
     actualRatio.set(rr.year,finite(rr.ratio,"business use percent",{max:100}));
   }
   if(actualRatio.size!==years.length)throw new RangeError("M3 asset business use ratios must cover every year");
 }
 if(!equal(land.grossCost+building.grossCost,acquisition))
   throw new RangeError("Land+building tax purchase basis must equal the one A01 acquisition cash");
 if(land.depreciationMethod!=="nonDepreciable"||
    !["detailed","standard"].includes(land.privateUseAdjustment)||
    building.privateUseAdjustment!=="detailed"||
    building.depreciationMethod!=="straightLine")
    throw new RangeError("M3 land is nondepreciable; mixed-use building requires reviewed detailed disposal treatment");
 const method=ownedReview.assetRates?.[building.id];
 if(!method||method.eligibilityReviewed!==true||method.usefulLifeReviewed!==true||
   method.version===undefined||!method.sourceUrl?.startsWith("https://")||
   !Number.isInteger(building.usefulLifeYears)||building.usefulLifeYears<1)
   throw new RangeError("M3 building rate, statutory life and eligibility require review");
 const rate=finite(method.rate,"annual depreciation rate",{max:1});
 if(rate<=0)throw new RangeError("Positive building straight-line rate required");
 const minResidual=finite(method.minimumResidualValue,"minimum book value");
 if(minResidual>building.taxBasis)throw new RangeError("Minimum book value above basis");
 const annualUse=[];
 const depreciationYears=[];
 const annualExpenseShares=[];
 for(const y of years){
   const review=annualReviews.get(y);
   const op=ordinaryReviews.get(y),days=yearDays(y);
   if(!Number.isInteger(review.businessSupplyDays)||review.businessSupplyDays!==days||
      review.separateGuestNightsReviewed!==true||
      review.separateBuildingSupplyDaysReviewed!==true||
      review.occupancyDerivedFromScenario!==true||
      !review.useEvidenceUrl?.startsWith("https://"))
     throw new RangeError("M3 building supply days and forecast guest nights require independent review");
   const areaBusiness=finite(review.businessFloorArea,"business floor area");
   const areaTotal=finite(review.totalFloorArea,"total floor area");
   if(areaTotal===0||areaBusiness===0||areaBusiness>=areaTotal)
     throw new RangeError("M3 must have both distinct nonzero private and business area");
   const forecastNights=sum(monthsOf(y).map(m=>operatingMonths.get(m).lodging.soldRoomNights));
   const allocated=sum(monthsOf(y).map(m=>operatingMonths.get(m).lodging.allocatedDays));
   const expected=finite(review.forecastGuestNights,"forecast guest nights");
   if(!equal(expected,forecastNights)||expected>allocated||
      review.reviewedLodgingAllocatedDays!==allocated||allocated>180)
     throw new RangeError("Actual/forecast guest nights differ from scenario or lodging allocation-days limit");
   const utility=allocateBusinessExpense({expense:1,method:"areaGuestNights",
      areaBusiness,areaTotal,actualGuestNights:forecastNights,daysInYear:days});
   const buildingShare=allocateBusinessExpense({expense:1,method:"areaBusinessPeriod",
      areaBusiness,areaTotal,businessDays:review.businessSupplyDays,daysInYear:days});
   const ordinary=op.deductibleShares;
   if(op.lodgingCategory!=="miscellaneous"||op.rentalCategory!==null||
      !ordinary||!equal(ordinary.propertyOperating,utility.share)||
      !equal(ordinary.lodgingOperating,1)||!equal(ordinary.rentalOperating,1)||
      !equal(ordinary.masterRent,1)||op.alternativeClassificationReviewed===true)
      throw new RangeError("M3 utility expense and misc-income review must equal area x forecast nights, not 180 lodging days");
   if(unitResult.financing.some(e=>e.category==="interest"&&e.month.slice(0,4)===String(y)&&e.amount<0)){
     if(!equal(op.interestDeductibleShare,buildingShare.share)||
        op.interestAccrualMatchesCash!==true)
       throw new RangeError("M3 interest business loan share requires review independent from guest nights");
   }
   for(const a of assets){
      const v=a.businessUseRatioByYear.find(z=>z.year===y);
      if(!v||!equal(v.ratio/100,buildingShare.share))
        throw new RangeError("M3 statutory business-use ratio must match reviewed building service area x period");
   }
   annualUse.push({taxYear:y,lodgingAllocatedDays:allocated,
     forecastSoldNights:forecastNights,calendarDays:days,
     businessFloorArea:areaBusiness,totalFloorArea:areaTotal,
     sharedUtilityExpenseShare:utility.share,buildingBusinessShare:buildingShare.share,
     separateAllocationMethods:["areaGuestNights","areaBusinessPeriod"],
     evidenceUrl:review.useEvidenceUrl});
   depreciationYears.push({taxYear:y,inServiceMonths:12,businessUseRatio:buildingShare.share,
     sourceUrl:method.sourceUrl,ruleBasis:"scenarioAssumption"});
   annualExpenseShares.push({taxYear:y,sharedUtilitiesDeductibleShare:utility.share,
      buildingDepreciationDeductibleShare:buildingShare.share});
 }
 const timeline=depreciateAssetTimeline({id:building.id,category:"building",
   openingBookValue:building.taxBasis,acquisitionBasis:building.taxBasis,
   annualRate:rate,method:"straightLine",minimumResidualValue:minResidual,
   years:depreciationYears});
 const basisReview=ownedReview.disposalBasisReview;
 if(!basisReview||basisReview.splitCalculationReviewed!==true||
    basisReview.dispositionExclusionReviewed!==true||
    !basisReview.ruleVersion||basisReview.use90PercentException===true)
    throw new RangeError("M3 private/business disposal basis needs independently reviewed monthly equivalents; no unreviewed 90% exception");
 const disposal=reconcileConcurrentUseSaleBasis({
   buildingId:building.id,ownerEntityId:unit.ownerEntityId,
   acquiredAt:start,soldAt:exit,acquisitionBasis:building.taxBasis,
   monthlyRecords:basisReview.monthlyRecords,
   splitCalculationReviewed:true,dispositionExclusionReviewed:true,
   ruleVersion:basisReview.ruleVersion
 });
 const monthMap=new Map(basisReview.monthlyRecords.map(m=>[m.month,m]));
 for(let i=0;i<years.length;i++){
    const y=years[i],share=annualUse[i].buildingBusinessShare;
    const records=monthsOf(y).map(m=>monthMap.get(m));
    if(records.some(m=>!m||!equal(m.businessShare,share)||!equal(m.privateShare,1-share)))
      throw new RangeError("Monthly sale-basis area shares must agree with reviewed active M3 use");
    const deductible=sum(records.map(m=>m.businessActualDeducted));
    if(!equal(deductible,timeline.rows[i].deductibleDepreciation))
      throw new RangeError("Current-year M3 depreciation must reconcile with independently reviewed monthly disposal expense history");
 }
 const saleGain=landBuildingSaleGain({
    ownerType:"individual",purchaseDate:start,saleDate:exit,
    proceeds:gross,sellingCosts,adjustedLandBasis:land.taxBasis,
    adjustedBuildingBasis:disposal.adjustedBuildingBasis
 });
 if(saleGain.gain<0)throw new RangeError("Personal M3 sale loss requires separate individual deduction eligibility");
 const individual=saleReview.individual;
 const expectedSource=saleGain.holdingClass==="long"?URLS.long:URLS.short;
 if(!individual||individual.taxRateEligibilityReviewed!==true||
    individual.rateSourceUrl!==expectedSource||!individual.ruleVersion||
    !Array.isArray(individual.residencePaymentMonths)||
    individual.residencePaymentMonths.length!==4)
    throw new RangeError("M3 separate capital-gain tax-year short/long rate and dates need reviewed evidence");
 const paymentMonths=[individual.nationalPaymentMonth,...individual.residencePaymentMonths];
 if(paymentMonths.some(m=>typeof m!=="string"||!/^\d{4}-(0[1-9]|1[0-2])$/.test(m))||
    Number(paymentMonths[0].slice(0,4))!==saleGain.saleYear+1||
    paymentMonths.some((m,i)=>i>0&&m<=paymentMonths[i-1])||
    individual.residencePaymentMonths.some(m=>{
      const yy=Number(m.slice(0,4)),mm=Number(m.slice(5,7));
      return !((yy===saleGain.saleYear+1&&mm>=6)||(yy===saleGain.saleYear+2&&mm===1));
    }))
    throw new RangeError("M3 capital-gain tax cash months must be independently reviewed");
 const tax=individualSaleGainTax({
   taxYear:saleGain.saleYear,taxableGain:saleGain.taxableGain,
   holdingClass:saleGain.holdingClass,eligibleReliefConfirmed:false,
   specialDeduction:0,
   reconstructionRate:finite(individual.reconstructionRate,"reconstruction",{max:1}),
   defenseIncomeRate:finite(individual.defenseIncomeRate,"defense",{max:1}),
   ruleSourceUrl:individual.rateSourceUrl
 });
 const national=tax.nationalBaseTax+tax.reconstructionTax+tax.defenseIncomeTax;
 const residence=tax.localResidenceTax;
 const amount=tax.totalTaxBeforeRounding;
 const weights=amount>0?[national/amount,...Array(4).fill(residence/(4*amount))]:
    [1,0,0,0,0];
 const saleAssessment={
   id:"reviewed-m3-personal-sale-"+unit.ownerEntityId+"-"+unit.id+"-"+saleGain.saleYear,
   entityId:unit.ownerEntityId,taxYear:saleGain.saleYear,taxKind:"saleGainTax",
   amount,status:"estimated",ruleVersion:individual.ruleVersion,sourceUrl:individual.rateSourceUrl,
   paymentMonths,paymentWeights:weights,breakdown:tax,
   note:"Scenario-estimated separate gains, independently reviewed basis reductions and forecast remittance dates"
 };
 const yearlyItems=timeline.rows.filter(x=>x.deductibleDepreciation>0).map(x=>({
    entityId:unit.ownerEntityId,taxYear:x.taxYear,category:"miscellaneous",
    kind:"depreciation",amount:x.deductibleDepreciation,
    sourceUnitId:unit.id,sourceLine:"buildingTaxDepreciation",assetId:building.id
 }));
 return {status:"estimated",unitId:unit.id,entityId:unit.ownerEntityId,
   modelId:"M3",taxYears:years,
   annualUse,annualExpenseShares,disposalEvidence:disposal,
   assetLines:[
      {assetId:land.id,category:"land",acquisitionBasis:land.taxBasis,
       annual:years.map(taxYear=>({taxYear,grossBookReduction:0,
         deductibleDepreciation:0,closingBookValue:land.taxBasis})),
       saleClosingBookValue:land.taxBasis},
      {assetId:building.id,category:"building",acquisitionBasis:building.taxBasis,
       annual:timeline.rows,saleClosingBookValue:disposal.adjustedBuildingBasis}
   ],
   ordinaryDepreciationItems:yearlyItems,corporateGainItems:[],
   individualSaleAssessment:saleAssessment,saleGain,
   acquisitionCash:acquisition,grossSaleCash:gross,disposalCosts:sellingCosts,
   taxBookValueAtExit:land.taxBasis+disposal.adjustedBuildingBasis,
   reconciliation:{
      acquisitionCashVsLandBuildingBasis:land.taxBasis+building.taxBasis-acquisition,
      operatingDeductedVsDisposalBusinessHistory:
        sum(timeline.rows.map(x=>x.deductibleDepreciation))-disposal.deductibleBusinessExpenseHistory,
      saleTaxGainVsCash:saleGain.gain-(gross-sellingCosts-land.taxBasis-disposal.adjustedBuildingBasis)
   },
   notes:[
     "180 allocated lodging days are NOT actual forecast sold nights and NOT building in-service days",
     "Shared utilities use separately reviewed area times expected guest nights; building depreciation uses area times business-supply period",
     "Monthly business/nonbusiness sale-basis equivalents are independent reviewed amounts, not inferred from ordinary depreciation",
     "Business depreciation reduces miscellaneous lodging income only; total reviewed disposal reduction adjusts building acquisition basis",
     "This is a private-use scenario sensitivity, not tax filing certification. VAT, legal relief, inherited or renovated assets and rule eligibility remain incomplete"
   ]};
}
