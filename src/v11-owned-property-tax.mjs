/**
 * Gate B — owned M4 real-estate tax ledger (reviewed scenario subset).
 *
 * Property acquisition was already paid once through A01 in Gate A.
 * Registered land/building asset costs are tax-basis evidence, NOT capex.
 * Straight-line building book-value reduction is NONCASH. Only reviewed
 * deductible portion enters ordinary income; the whole reduction enters
 * disposal basis. Land is nondepreciable.
 *
 * This does not claim that an input annual rate is legally correct. Invoices,
 * useful life, business use and the rate are explicitly reviewed externally.
 *
 * References:
 * https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2100.htm
 * https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3202.htm
 * https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3208.htm
 * https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3211.htm
 */
import {depreciateAssetTimeline} from "./tax-rules.mjs";
import {landBuildingSaleGain} from "./tax.mjs";
import {individualSaleGainTax} from "./tax-detail.mjs";

const yen=(v,name)=>{if(typeof v!=="number"||!Number.isFinite(v)||v<0)throw new RangeError(name+" must be nonnegative finite yen");return v;};
const ratio=(v,name)=>{yen(v,name);if(v>1)throw new RangeError(name+" must be <= 1");return v;};
const name=(v,k)=>{if(typeof v!=="string"||!v)throw new TypeError(k+" required");return v;};
const close=(a,b)=>Math.abs(a-b)<=Math.max(1e-6,Math.abs(b)*1e-10);
const date=(d,k)=>{name(d,k);if(!/^\d{4}-\d{2}-\d{2}$/.test(d))throw new RangeError(k+" ISO date required");const v=new Date(d+"T00:00:00Z");if(!Number.isFinite(+v)||v.toISOString().slice(0,10)!==d)throw new RangeError(k+" invalid date");return d;};
const monthNumber=s=>Number(s.slice(5,7));
const taxItem=(entityId,taxYear,kind,amount,sourceUnitId,sourceLine)=>({
 entityId,taxYear,category:"corporate",kind,amount,
 sourceUnitId,sourceLine
});
const sourceUrls={
 dep:"https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2100.htm",
 gain:"https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3202.htm",
 long:"https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3208.htm",
 short:"https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3211.htm"
};
export const ownedPropertyPrimarySources=Object.freeze({...sourceUrls});
/**
 * All tax-year coverage is required. The narrow subset is M4 all-year rental,
 * acquired new on Jan 1 and sold on Dec 31 in the holding window. Any private
 * use, prior ownership, asset additions, VAT, capitalized closing costs,
 * refurbishment or early disposals requires a different reviewed contract.
 *
 * ownedReview { unitId, reviewStatus, reviewedTaxBasis, costAllocationSourceUrl,
 *   assetRates:{[buildingAssetId]:{rate, usefulLifeReviewed, sourceUrl,version}},
 *   saleReview:{grossPriceReviewed, eligibleRelief:false, ...,
 *     individual:{reconstructionRate,defenseIncomeRate,sourceUrl,ruleVersion,
 *       nationalPaymentMonth,residencePaymentMonths:[4 YYYY-MM]}}
 * }
 */
export function deriveOwnedM4TaxRegister({unit,unitResult,ownerType,ownedReview}){
 if(unit?.tenure!=="own"||unit.modelId!=="M4"||unitResult?.status!=="computed"||
   !["individual","corporation"].includes(ownerType))
   throw new RangeError("Owned register supports only calculated owned M4 ordinary residential rental");
 if(unit.ownerEntityId!==unit.operatorEntityId||
   unitResult.entityId!==unit.ownerEntityId||
   unit.tenantEntityId!==null&&unit.tenantEntityId!==undefined)
   throw new RangeError("Owned tax asset must share tax and cash entity; no separate tenant");
 if(ownedReview?.unitId!==unit.id||
    ownedReview.reviewStatus!=="reviewedScenarioAssumption"||
    ownedReview.reviewedTaxBasis!==true||
    !ownedReview.costAllocationSourceUrl?.startsWith("https://"))
   throw new RangeError("Independent land/building allocation evidence and review required");
 const start=date(unit.startDate,"startDate"),op=date(unit.operationStartDate,"operationStartDate");
 const exit=date(unit.exit?.exitDate,"exitDate");
 if(start!==op||start.slice(5)!=="01-01"||exit.slice(5)!=="12-31"||
    !(exit>start))
   throw new RangeError("Owned pilot requires Jan-1 acquisition/opening, Dec-31 sale and no prior private use");
 if(unit.exit?.method!=="priceGrowth"||unit.exit.applyResidentialRelief!==false)
   throw new RangeError("Unreviewed sale method/relief is blocked");
 if((unit.expenses??[]).some(e=>e.taxTreatment!=="deductible"||
      e.businessUseRatio!==undefined&&e.businessUseRatio!==100))
   throw new RangeError("Expense with partial/non-deductible tax treatment requires a separate review");
 if((unit.loans??[]).some(l=>yen(l.fees??0,"loan fee")!==0))
   throw new RangeError("Financing fees need separately reviewed capitalized tax treatment");
 const years=Array.from({length:Number(exit.slice(0,4))-Number(start.slice(0,4))+1},
    (_,i)=>Number(start.slice(0,4))+i);
 if(!years.length||years.length>50)throw new RangeError("Tax year span invalid");
 if(unitResult.operating.length!==12*years.length)
   throw new RangeError("Full-year monthly operating coverage required");
 for(const operating of unitResult.operating){
   const month=operating.month;
   if(!years.includes(Number(month.slice(0,4)))||
      operating.result.lodging.allocatedDays!==0||
      operating.result.rental.allocatedDays!==operating.result.calendarDays||
      operating.result.calendarDays!==operating.result.rental.allocatedDays)
     throw new RangeError("Owned M4 register cannot infer private or partial rental tax treatment");
 }
 const cash=unitResult.investing;
 const purchases=cash.filter(e=>e.category==="acquisitionPrice");
 const proceeds=cash.filter(e=>e.category==="disposalProceeds");
 const closings=cash.filter(e=>e.category==="closingCosts");
 const saleCosts=cash.filter(e=>e.category==="saleCosts");
 if(purchases.length!==1||proceeds.length!==1||
    closings.some(e=>e.amount!==0)||
    cash.some(e=>["initialCapEx","expansionCapEx","maintenanceCapEx"].includes(e.category)&&e.amount!==0))
   throw new RangeError("Single A01 purchase/sale only; capital work or capitalized closing cost must be separately reviewed");
 const purchase=yen(-purchases[0].amount,"acquisition cash");
 const price=yen(proceeds[0].amount,"gross sale cash");
 const costs=saleCosts.reduce((sum,e)=>sum+yen(-e.amount,"selling cash"),0);
 if(!close(costs,unit.exit.sellingCosts))throw new RangeError("Sale cash costs not reconciled");
 const review=ownedReview.saleReview;
 if(!review||review.reviewStatus!=="reviewedScenarioAssumption"||
    review.eligibleRelief!==false||
    review.exitCostsDeductibleReviewed!==true||
    review.saleProceedsMatchCash!==true||
    review.salePriceSourceUrl?.startsWith("https://")!==true)
   throw new RangeError("Reviewed gross disposal price and deductible selling costs required");
 if(!close(yen(review.grossPriceReviewed,"sale review gross"),price)||
    !close(yen(review.sellingCostsReviewed,"sale review costs"),costs))
   throw new RangeError("Reviewed disposal price/costs must exactly equal Gate A cash");
 const assets=unit.assets??[];
 if(assets.length!==2||
    new Set(assets.map(a=>a.category)).size!==2||
    !assets.some(a=>a.category==="land")||!assets.some(a=>a.category==="building"))
   throw new RangeError("Exactly one land and one building asset register required; later assets need separate exit basis");
 if(!Array.isArray(unitResult.financing))throw new TypeError("Loan financing events required");
 const investmentIds=new Set();
 let basisTotal=0;
 let landBasis=0,buildingBasis=0;
 const assetLines=[],depreciationItems=[];
 for(const a of assets){
   name(a.id,"asset id");
   if(investmentIds.has(a.id))throw new RangeError("Duplicate owned asset id");
   investmentIds.add(a.id);
   if(a.ownerEntityId!==unit.ownerEntityId||
      date(a.invoiceDate,"invoiceDate")!==start||
      date(a.inServiceDate,"inServiceDate")!==start||
      date(a.disposalDate,"asset disposalDate")!==exit||
      yen(a.grossCost,"asset gross cost")!==yen(a.taxBasis,"asset tax basis")||
      !close(yen(a.taxBookValue,"initial tax book"),a.taxBasis)||
      yen(a.priorAccumulatedDepreciation??0,"previous book reductions")!==0||
      a.privateUseAdjustment!=="notApplicable")
     throw new RangeError("New asset cost/in-service/initial tax book/private-use history must be reconciled");
   if(!Array.isArray(a.businessUseRatioByYear)||a.businessUseRatioByYear.length!==years.length)
     throw new RangeError("Owned asset must have exhaustive annual business use history");
   const ratios=new Map();
   for(const r of a.businessUseRatioByYear){
     if(!years.includes(r.year)||ratios.has(r.year)||r.ratio!==100)
       throw new RangeError("This owned pilot requires reviewed 100% business-use ratio in each year");
     ratios.set(r.year,r.ratio);
   }
   if(years.some(y=>!ratios.has(y)))throw new RangeError("Missing asset business-use tax year");
   basisTotal+=a.taxBasis;
   if(a.category==="land"){
     if(a.depreciationMethod!=="nonDepreciable"||
        a.usefulLifeYears!==null&&a.usefulLifeYears!==undefined)
       throw new RangeError("Land must be non-depreciable");
     landBasis=a.taxBasis;
     assetLines.push({assetId:a.id,category:"land",acquisitionBasis:a.taxBasis,
      annual:years.map(taxYear=>({taxYear,grossBookReduction:0,deductibleDepreciation:0,
        closingBookValue:a.taxBasis})),saleClosingBookValue:a.taxBasis});
   }else{
     if(a.depreciationMethod!=="straightLine")throw new RangeError("Building requires reviewed straight-line method");
     const r=ownedReview.assetRates?.[a.id];
     if(!r||r.usefulLifeReviewed!==true||
        r.eligibilityReviewed!==true||!r.sourceUrl?.startsWith("https://")||
        !r.version||r.sourceUrl!==sourceUrls.dep)
       throw new RangeError("Building statutory straight-line annual rate requires reviewed provenance");
     if(a.usefulLifeYears===null||a.usefulLifeYears===undefined||!(a.usefulLifeYears>0))
       throw new RangeError("Building useful life missing");
     const rate=ratio(r.rate,"straight-line annual rate");
     if(rate<=0)throw new RangeError("Positive building straight-line rate required");
     const minimum=yen(r.minimumResidualValue,"minimum residual value");
     if(minimum>a.taxBasis)throw new RangeError("Residual value > acquisition tax basis");
     const timeline=depreciateAssetTimeline({
       id:a.id,category:"building",openingBookValue:a.taxBasis,acquisitionBasis:a.taxBasis,
       annualRate:rate,method:"straightLine",minimumResidualValue:minimum,
       years:years.map(taxYear=>({taxYear,inServiceMonths:12,businessUseRatio:1,
         sourceUrl:r.sourceUrl,ruleBasis:"scenarioAssumption"}))
     });
     for(const row of timeline.rows){
       if(!close(row.deductibleDepreciation,row.grossBookReduction)||row.privateUseReduction!==0)
         throw new RangeError("Private-use asset cannot flow through all-business pilot");
       if(row.deductibleDepreciation>0)depreciationItems.push({
         entityId:unit.ownerEntityId,taxYear:row.taxYear,category:ownerType==="corporation"?"corporate":"realEstate",
         kind:"depreciation",amount:row.deductibleDepreciation,
         sourceUnitId:unit.id,sourceLine:"buildingTaxDepreciation",assetId:a.id
       });
     }
     buildingBasis=timeline.closingBookValue;
     assetLines.push({assetId:a.id,category:"building",acquisitionBasis:a.taxBasis,
        annual:timeline.rows,saleClosingBookValue:buildingBasis});
   }
 }
 if(!close(basisTotal,purchase))throw new RangeError("Land/building tax asset acquisition sum must equal A01 cash purchase price");
 if(!close(landBasis+buildingBasis+assetLines.filter(a=>a.category==="building")
   .flatMap(a=>a.annual).reduce((sum,row)=>sum+row.grossBookReduction,0),purchase))
     throw new RangeError("Purchase book reconciliation failed");
 const gain=landBuildingSaleGain({ownerType,purchaseDate:start,saleDate:exit,
   proceeds:price,sellingCosts:costs,adjustedLandBasis:landBasis,
   adjustedBuildingBasis:buildingBasis});
 if(gain.gain<0)
   throw new RangeError("Sale loss offset eligibility needs separate reviewed disposal loss model");
 const corporateGainItems=ownerType==="corporation"&&gain.gain>0?[
   taxItem(unit.ownerEntityId,gain.saleYear,"revenue",gain.gain,unit.id,"reviewedCorporateAssetDisposalGain")
 ]:[];
 let personalSaleAssessment=null;
 if(ownerType==="individual"){
   const indiv=review.individual;
   if(!indiv||!indiv.taxRateEligibilityReviewed||!indiv.rateSourceUrl?.startsWith("https://")||
      !indiv.ruleVersion||indiv.rateSourceUrl!==(gain.holdingClass==="long"?sourceUrls.long:sourceUrls.short))
     throw new RangeError("Individual capital-gain short/long statutory rate and tax year must be reviewed");
   if(!Array.isArray(indiv.residencePaymentMonths)||indiv.residencePaymentMonths.length!==4||
      typeof indiv.nationalPaymentMonth!=="string")
     throw new RangeError("Explicit national/local capital-gain payment months required");
   const settlement=[indiv.nationalPaymentMonth,...indiv.residencePaymentMonths];
   if(settlement.some(m=>!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)||
      Number(m.slice(0,4))!==gain.saleYear+1))
      throw new RangeError("Capital gains due must be next calendar year in this reviewed model");
   const capitalTax=individualSaleGainTax({
     taxYear:gain.saleYear,taxableGain:gain.taxableGain,holdingClass:gain.holdingClass,
     eligibleReliefConfirmed:false,specialDeduction:0,
     reconstructionRate:ratio(indiv.reconstructionRate,"reconstruction tax rate"),
     defenseIncomeRate:ratio(indiv.defenseIncomeRate,"defense income tax rate"),
     ruleSourceUrl:indiv.rateSourceUrl
   });
   const national=capitalTax.nationalBaseTax+capitalTax.reconstructionTax+capitalTax.defenseIncomeTax;
   const local=capitalTax.localResidenceTax;
   const full=capitalTax.totalTaxBeforeRounding;
   const weights=full>0?[national/full,...indiv.residencePaymentMonths.map(()=>local/(4*full))]:
     [1,0,0,0,0];
   personalSaleAssessment={
     id:"reviewed-individual-sale-"+unit.ownerEntityId+"-"+unit.id+"-"+gain.saleYear,
     entityId:unit.ownerEntityId,taxYear:gain.saleYear,taxKind:"saleGainTax",
     amount:full,status:"estimated",ruleVersion:indiv.ruleVersion,
     sourceUrl:indiv.rateSourceUrl,
     paymentMonths:settlement,paymentWeights:weights,
     breakdown:capitalTax,
     note:"Tax cash timing/eligibility are reviewed modeling assumptions; no personal residence relief"
   };
 }
 return {status:"estimated",unitId:unit.id,entityId:unit.ownerEntityId,
   taxYears:years,assetLines,ordinaryDepreciationItems:depreciationItems,
   corporateGainItems,individualSaleAssessment:personalSaleAssessment,
   saleGain:gain,acquisitionCash:purchase,grossSaleCash:price,disposalCosts:costs,
   taxBookValueAtExit:landBasis+buildingBasis,
   reconciliation:{acquisitionCashVsLandBuildingBasis:basisTotal-purchase,
     saleTaxGainVsCash:gain.gain-(price-costs-landBasis-buildingBasis)},
   notes:[
     "Assets registered land/building are already paid in A01; never add their acquisition price again to ICF",
     "Depreciation is a noncash taxable-income expense, not an additional investing cash item",
     "Individual sale is separate land/building capital gains, not rental operating revenue",
     "Corporate gain is included in corporate income tax calculation, not twice as receipt",
     "This all-business M4 subset excludes private use, VAT, adjustments to basis, extra capital assets and statutory rounding"
   ]};
}
