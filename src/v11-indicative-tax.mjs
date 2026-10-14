/**
 * v1.1 INDICATIVE / WHAT-IF investor tax and VAT scenario.
 *
 * NOT a filing-grade tax engine and not part of statutory Gate B acceptance.
 * Every approximation is a visible, editable scenario assumption.
 * Converts existing unit operating and finance records into:
 *   (a) gross-vs-net operating cash VAT adjustments,
 *   (b) approximate VAT settlement, and
 *   (c) subsequent cash income/capital-gain taxes.
 *
 * IMPORTANT: Existing operations are considered TAX-EXCLUSIVE for revenue
 * and vendor expense lines. Property purchase/sale and all investment cash
 * are intentionally left unchanged under explicit "VAT excluded" assumption.
 * Input VAT credits are never refunded automatically. No project-loss tax
 * refund/cross-category loss offset is presumed.
 */
import {landBuildingSaleGain} from "./tax.mjs";

const finite=(v,k,min=0,max=Infinity)=>{
 if(typeof v!=="number"||!Number.isFinite(v)||v<min||v>max)
  throw new RangeError(k+" must be a finite number between "+min+" and "+max);
 return v;
};
const pct=(v,k)=>finite(v,k,0,1);
const id=(v,k)=>{if(typeof v!=="string"||!v)throw new TypeError(k+" required");return v;};
const sum=xs=>xs.reduce((a,b)=>a+b,0);
const ym=(y,m)=>String(y)+"-"+String(m).padStart(2,"0");
const yearDays=y=>new Date(Date.UTC(y+1,0,1))-new Date(Date.UTC(y,0,1));
const roundTrip=(values)=>values.every(x=>Number.isFinite(x));
const categories=["business","miscellaneous","realEstate","corporate"];
const near=(a,b)=>Math.abs(a-b)<=Math.max(1e-6,Math.abs(b)*1e-10);

export function defaultV11IndicativeAssumptions(document){
 if(!document?.entities||!Array.isArray(document.entities))throw new TypeError("v1.1 entities required");
 return {
  version:"v11-indicative-scenario-1",
  personalOrdinaryEffectiveRate:0.30,
  corporateEffectiveRate:0.30,
  personalShortSaleGainRate:0.40,
  personalLongSaleGainRate:0.20,
  nationalTaxCashShare:0.65,
  saleNationalTaxCashShare:0.77,
  vatRate:0.10,
  vatRegisteredByEntity:Object.fromEntries(document.entities.map(e=>[e.id,false])),
  vatInputCreditRecoveryFactor:1,
  vatSettlementMonth:3,
  buildingAnnualDepreciationRate:0.05,
  assumedBuildingShareOfPurchase:0.60,
  mixedUseBusinessFloorShare:0.60,
  mixedUseBuildingServiceShare:1,
  inputAmountsBasis:"operatingNetAndInvestingCashAsGiven",
  assetTransactionVAT:"excludedByScenarioAssumption",
  noAutomaticTaxRefunds:true,
  crossCategoryLossOffset:"disabled",
  vendorExpenseVAT:"allThreeOperatingExpenseCategories",
  withholdingAndPriorPayments:"excludedByScenarioAssumption",
  fixedYearEndCashTiming:"incomeNextYearAndResidentsIntoFollowingJanuary"
 };
}
function validate(document,a){
 if(!a||a.version!=="v11-indicative-scenario-1")
   throw new RangeError("Indicative scenario version required; do not assume tax rates silently");
 const fields=["personalOrdinaryEffectiveRate","corporateEffectiveRate",
  "personalShortSaleGainRate","personalLongSaleGainRate","nationalTaxCashShare",
  "saleNationalTaxCashShare","vatRate","vatInputCreditRecoveryFactor",
  "buildingAnnualDepreciationRate","assumedBuildingShareOfPurchase",
  "mixedUseBusinessFloorShare","mixedUseBuildingServiceShare"];
 for(const field of fields)pct(a[field],field);
 if(!Number.isInteger(a.vatSettlementMonth)||a.vatSettlementMonth<1||
    a.vatSettlementMonth>12)throw new RangeError("VAT settlement month must be 1..12");
 const expected=document.entities.map(e=>e.id);
 const statuses=a.vatRegisteredByEntity;
 if(!statuses||Object.keys(statuses).length!==expected.length||
    expected.some(k=>typeof statuses[k]!=="boolean")||
    Object.keys(statuses).some(k=>!expected.includes(k)))
    throw new RangeError("Explicit VAT registration status required for every taxpayer");
 for(const [k,v] of Object.entries({
  inputAmountsBasis:"operatingNetAndInvestingCashAsGiven",
  assetTransactionVAT:"excludedByScenarioAssumption",
  noAutomaticTaxRefunds:true,
  crossCategoryLossOffset:"disabled",
  vendorExpenseVAT:"allThreeOperatingExpenseCategories",
  withholdingAndPriorPayments:"excludedByScenarioAssumption",
  fixedYearEndCashTiming:"incomeNextYearAndResidentsIntoFollowingJanuary"
 }))if(a[k]!==v)throw new RangeError("Unsupported indicative assumption "+k);
 return structuredClone(a);
}
const personCategory=(model,stream)=>stream==="rental"?"realEstate":
 model==="M1"?"business":"miscellaneous";
function collect(entities){
 const map=new Map();
 for(const e of entities){
  id(e.id,"entity id");
  if(!["individual","corporation"].includes(e.taxpayerType))
   throw new RangeError("Unsupported indicative taxpayer");
 }
 const find=(e,year)=>{
   const key=e.id+"|"+year;
   if(!map.has(key))map.set(key,{
     entityId:e.id,entityType:e.taxpayerType,taxYear:year,
     lodgingRevenue:0,rentalRevenue:0,netOperatingExpenses:0,
     netBusinessDeductibleExpenses:0,financingInterestPaid:0,
     deductibleInterest:0,buildingGrossDepreciation:0,
     allowableDepreciation:0,corporateSaleGain:0,
     taxableVatOutput:0,vendorVatGrossPaid:0,
     candidateInputVatCredit:0,vatDeductibleBeforeCredit:0,
     categoryProfit:Object.fromEntries(categories.map(k=>[k,0]))
   });
   return map.get(key);
 };
 return {map,find};
}
const pushCash=(map,entityId,month,category,value)=>{
 finite(Math.abs(value),"VAT cash movement");
 if(value===0)return;
 const key=entityId+"|"+month;
 const row=map.get(key)??{entityId,month,operating:0,collectionsVAT:0,vendorVATCash:0,vatSettlement:0};
 row.operating+=value;row[category]+=value;map.set(key,row);
};
const pushTax=(taxes,entityId,month,taxKind,amount)=>{
 finite(amount,"estimated cash tax");
 if(amount===0)return;
 const k=entityId+"|"+month+"|"+taxKind;
 taxes.set(k,(taxes.get(k)??0)+amount);
};
function paymentMonths(year,split,amount,entityId,kind,taxes){
 finite(amount,"estimated income tax amount");
 if(amount===0)return;
 if(kind==="corporateTax"){
  pushTax(taxes,entityId,ym(year+1,2),"indicativeCorporateIncomeTax",-amount);
  return;
 }
 const national=amount*split,local=amount-national;
 const nationalKind=kind==="saleGain"?"indicativeSaleNationalTax":"indicativePersonalNationalTax";
 const localKind=kind==="saleGain"?"indicativeSaleResidenceTax":"indicativePersonalResidenceTax";
 pushTax(taxes,entityId,ym(year+1,3),nationalKind,-national);
 const months=[[year+1,6],[year+1,8],[year+1,10],[year+2,1]];
 for(const [y,m] of months)pushTax(taxes,entityId,ym(y,m),localKind,-local/4);
}
function businessShare(unit,year,annualNights,assumptions){
 const mix=unit.modelId==="M3";
 const denom=yearDays(year)/86400000;
 return {utilityShare:mix?
   assumptions.mixedUseBusinessFloorShare*Math.min(annualNights/denom,1):1,
   depreciationShare:mix?assumptions.mixedUseBusinessFloorShare*
     assumptions.mixedUseBuildingServiceShare:1};
}
export function estimateV11IndicativeTaxCash({document,unitResults,assumptions}){
 if(document?.schemaVersion!=="1.1.0"||!Array.isArray(document.entities)||
   !Array.isArray(document.units)||!Array.isArray(unitResults))
  throw new TypeError("Saved v1.1 document and complete unit results required");
 const a=validate(document,assumptions);
 const entities=new Map(document.entities.map(e=>[e.id,e]));
 const stored=new Map(document.units.map(u=>[u.id,u]));
 const {map:years,find}=collect(document.entities);
 const cash=new Map(),taxes=new Map(),sales=[],unitProof=[];
 const seen=new Set();
 for(const u of unitResults){
  if(u.status!=="computed"||!stored.has(u.unitId)||!entities.has(u.entityId)||
     u.entityId!==stored.get(u.unitId).operatorEntityId)
   throw new RangeError("All indicative unit reports must be computed for matching tax entities");
  const unit=stored.get(u.unitId),entity=entities.get(u.entityId);
  const registered=a.vatRegisteredByEntity[entity.id],monthsByYear=new Map();
  const expenses=["lodgingOperating","rentalOperating","propertyOperating"];
  for(const o of u.operating){
   if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(o.month)||seen.has(u.unitId+"|"+o.month))
    throw new RangeError("Duplicate/invalid indicative unit-month");
   seen.add(u.unitId+"|"+o.month);
   const result=o.result;if(result?.status!=="computed")
    throw new RangeError("Noncomputed month cannot become estimated zero");
   const y=Number(o.month.slice(0,4));
   const arr=monthsByYear.get(y)??[];arr.push(o);monthsByYear.set(y,arr);
  }
  if(!monthsByYear.size)throw new RangeError("Empty operating unit");
  // First pass: category-tagged net cash revenues/expenses and VAT-inclusive
  // adjustments. Cash operating outlays already contain the NET amounts once.
  for(const [year,rows] of monthsByYear){
   const subtotal=find(entity,year);
   const forecastNights=sum(rows.map(o=>finite(o.result.lodging.soldRoomNights,"forecast sold nights")));
   const shares=businessShare(unit,year,forecastNights,a);
   let annualRevenue=0,annualExpenses=0;
   for(const o of rows){
    const r=o.result,month=o.month;
    const lodging=finite(r.lodging.revenue,"lodging revenue");
    const rental=finite(r.rental.revenue,"rental revenue");
    const common=finite(r.expenses.propertyOperating,"property operating cost");
    const lodgingCost=finite(r.expenses.lodgingOperating,"lodging operating cost");
    const rentalCost=finite(r.expenses.rentalOperating,"rental operating cost");
    const headRent=finite(r.expenses.masterRent,"master rent");
    const sharedTaxShare=shares.utilityShare;
    annualRevenue+=lodging+rental;
    annualExpenses+=lodgingCost+rentalCost+common+headRent;
    subtotal.lodgingRevenue+=lodging;subtotal.rentalRevenue+=rental;
    subtotal.netOperatingExpenses+=lodgingCost+rentalCost+common+headRent;
    const lodgingCategory=entity.taxpayerType==="corporation"?"corporate":personCategory(unit.modelId,"lodging");
    const rentalCategory=entity.taxpayerType==="corporation"?"corporate":"realEstate";
    subtotal.categoryProfit[lodgingCategory]+=lodging-lodgingCost;
    subtotal.categoryProfit[rentalCategory]+=rental-rentalCost-headRent;
    let lodgeShare=1,rentShare=0;
    if(lodging>0&&rental>0){lodgeShare=lodging/(lodging+rental);rentShare=1-lodgeShare;}
    else if(rental>0){lodgeShare=0;rentShare=1;}
    else if(lodging===0&&rental===0){
      const d=r.lodging.allocatedDays+r.rental.allocatedDays;
      lodgeShare=d>0?r.lodging.allocatedDays/d:1;
      rentShare=1-lodgeShare;
    }
    const commonBusinessExpense=common*sharedTaxShare;
    subtotal.categoryProfit[lodgingCategory]-=commonBusinessExpense*lodgeShare;
    subtotal.categoryProfit[rentalCategory]-=commonBusinessExpense*rentShare;
    subtotal.netBusinessDeductibleExpenses+=lodgingCost+rentalCost+headRent+commonBusinessExpense;
    const outputVAT=registered?lodging*a.vatRate:0;
    const vendorVAT=(lodgingCost+rentalCost+common)*a.vatRate;
    const eligibleVendorVAT=(lodgingCost+common*sharedTaxShare)*a.vatRate;
    // Rents are treated as residential exempt. Rental-operation vendors are
    // assumed taxable cash suppliers, but have no input VAT credit here.
    // VAT input credit for lodging/common only if entity VAT-registered.
    const candidateInput=registered?eligibleVendorVAT*a.vatInputCreditRecoveryFactor:0;
    subtotal.taxableVatOutput+=outputVAT;
    subtotal.vendorVatGrossPaid+=vendorVAT;
    subtotal.candidateInputVatCredit+=candidateInput;
    // When a supplier VAT payment relates to business expenses, the
    // non-credited share is also assumed deductible for ordinary income.
    const taxableVendorVat=(lodgingCost+rentalCost+common*sharedTaxShare)*a.vatRate;
    subtotal.vatDeductibleBeforeCredit+=taxableVendorVat;
    subtotal.categoryProfit[lodgingCategory]-=(lodgingCost+common*sharedTaxShare*lodgeShare)*a.vatRate;
    subtotal.categoryProfit[rentalCategory]-=(rentalCost+common*sharedTaxShare*rentShare)*a.vatRate;
    pushCash(cash,entity.id,month,"collectionsVAT",outputVAT);
    pushCash(cash,entity.id,month,"vendorVATCash",-vendorVAT);
   }
   const interest=sum(u.financing.filter(e=>e.category==="interest"&&Number(e.month.slice(0,4))===year)
       .map(e=>-e.amount));
   finite(interest,"interest paid");
   subtotal.financingInterestPaid+=interest;
   const deductibleInterest=interest*shares.depreciationShare;
   subtotal.deductibleInterest+=deductibleInterest;
   const splitRevenue=subtotal.lodgingRevenue+subtotal.rentalRevenue; // entity-wide not unit-wide:
   // Use this unit's annual stream allocation instead of another unit's.
   const unitLodging=sum(rows.map(x=>x.result.lodging.revenue));
   const unitRental=sum(rows.map(x=>x.result.rental.revenue));
   const lodgingFraction=unitLodging+unitRental>0?unitLodging/(unitLodging+unitRental):
      unit.modelId==="M3"||unit.modelId==="M1"?1:0;
   const lp=entity.taxpayerType==="corporation"?"corporate":personCategory(unit.modelId,"lodging");
   const rp=entity.taxpayerType==="corporation"?"corporate":"realEstate";
   subtotal.categoryProfit[lp]-=deductibleInterest*lodgingFraction;
   subtotal.categoryProfit[rp]-=deductibleInterest*(1-lodgingFraction);
   let depreciationGross=0,depreciationDeductible=0,buildingBasis=0;
   const purchase=sum(u.investing.filter(e=>e.category==="acquisitionPrice")
     .map(e=>-e.amount));
   if(unit.tenure==="own"){
    const buildings=(unit.assets??[]).filter(x=>x.category==="building");
    const land=(unit.assets??[]).filter(x=>x.category==="land");
    if(buildings.length===1&&land.length===1){
       buildingBasis=finite(buildings[0].taxBasis,"building tax basis");
       const assetsTotal=finite(land[0].taxBasis,"land tax basis")+buildingBasis;
       if(!near(assetsTotal,purchase))throw new RangeError("Owned indicative asset basis must match paid acquisition");
    }else if(!buildings.length&&!land.length){
       buildingBasis=purchase*a.assumedBuildingShareOfPurchase;
    }else throw new RangeError("Partial land/building cost register cannot be estimated without an explicit proportion");
    const serviceMonths=rows.filter(x=>x.month>=unit.operationStartDate.slice(0,7)).length;
    depreciationGross=buildingBasis*a.buildingAnnualDepreciationRate*serviceMonths/12;
    depreciationDeductible=depreciationGross*shares.depreciationShare;
    subtotal.buildingGrossDepreciation+=depreciationGross;
    subtotal.allowableDepreciation+=depreciationDeductible;
    subtotal.categoryProfit[lp]-=depreciationDeductible*lodgingFraction;
    subtotal.categoryProfit[rp]-=depreciationDeductible*(1-lodgingFraction);
   }
   unitProof.push({unitId:unit.id,entityId:entity.id,taxYear:year,
      lodgingAllocatedDays:sum(rows.map(x=>x.result.lodging.allocatedDays)),
      forecastLodgingNights:forecastNights,
      guestNightBasedSharedExpenseShare:shares.utilityShare,
      buildingTaxExpenseBusinessShare:shares.depreciationShare,
      netRevenue:annualRevenue,netOperatingCosts:annualExpenses,
      interestPaid:interest,interestDeductible:deductibleInterest,
      buildingBasis,assumedNoncashDepreciationGross:depreciationGross,
      assumedNoncashDepreciationDeducted:depreciationDeductible});
  }
  if(unit.tenure==="own"){
    const purchase=sum(u.investing.filter(x=>x.category==="acquisitionPrice").map(x=>-x.amount));
    const grossSale=sum(u.investing.filter(x=>x.category==="disposalProceeds").map(x=>x.amount));
    const sellingCosts=sum(u.investing.filter(x=>x.category==="saleCosts").map(x=>-x.amount));
    const year=Number(unit.exit.exitDate.slice(0,4));
    const grossDep=sum(unitProof.filter(x=>x.unitId===unit.id).map(x=>x.assumedNoncashDepreciationGross));
    const buildingBasis=unitProof.find(x=>x.unitId===unit.id)?.buildingBasis??0;
    const landBasis=purchase-buildingBasis;
    const adjustedBuilding=Math.max(1,buildingBasis-grossDep);
    const sale=landBuildingSaleGain({
     ownerType:entity.taxpayerType,purchaseDate:unit.startDate,saleDate:unit.exit.exitDate,
     proceeds:grossSale,sellingCosts,adjustedLandBasis:landBasis,
     adjustedBuildingBasis:adjustedBuilding
    });
    const positiveGain=Math.max(0,sale.gain);
    const rate=sale.holdingClass==="long"?a.personalLongSaleGainRate:a.personalShortSaleGainRate;
    if(entity.taxpayerType==="corporation")find(entity,year).corporateSaleGain+=positiveGain;
    else paymentMonths(year,a.saleNationalTaxCashShare,positiveGain*rate,entity.id,"saleGain",taxes);
    sales.push({unitId:unit.id,entityId:entity.id,taxYear:year,holdingClass:sale.holdingClass,
      saleGross:grossSale,sellingCosts,acquisitionPurchase:purchase,
      assumedBuildingBasis:buildingBasis,
      assumedCumulativeBuildingReduction:grossDep,
      estimatedAdjustedTaxBasis:landBasis+adjustedBuilding,
      positiveTaxableGain:positiveGain,estimatedGainRate:entity.taxpayerType==="individual"?rate:a.corporateEffectiveRate,
      assumedTransactionVATExcluded:true});
  }
 }
 const vatRows=[],taxRows=[];
 for(const row of [...years.values()].sort((x,y)=>x.taxYear-y.taxYear||x.entityId.localeCompare(y.entityId))){
   const registered=a.vatRegisteredByEntity[row.entityId];
   const candidate=registered?row.candidateInputVatCredit:0;
   const appliedCredit=Math.min(candidate,row.taxableVatOutput);
   const remainder=row.taxableVatOutput-appliedCredit;
   const allocatedCreditFactor=candidate>0?appliedCredit/candidate:0;
   const creditToBusinessTax=appliedCredit; // all candidate credit relates to lodging/shared business costs
   row.categoryProfit[ row.entityType==="corporation"?"corporate":"miscellaneous"]+=0;
   // Input VAT capitalized into a deductible business expense only if not
   // recovered. Allocate actual credits to activity categories in proportion
   // to separately retained common/lodging VAT sources; currently all input
   // credits belong to lodging miscellaneous/business or corporate.
   if(creditToBusinessTax>0){
     const activeCategories=row.entityType==="corporation"?["corporate"]:
        ["business","miscellaneous"];
     const target=activeCategories.find(k=>row.categoryProfit[k]!==0)??activeCategories[0];
     row.categoryProfit[target]+=creditToBusinessTax;
   }
   const profitTotal=sum(Object.values(row.categoryProfit));
   if(row.entityType==="corporation"){
      row.categoryProfit.corporate+=row.corporateSaleGain;
   }
   const taxBase=row.entityType==="corporation"?
     Math.max(0,row.categoryProfit.corporate):
     sum(["business","miscellaneous","realEstate"].map(k=>Math.max(0,row.categoryProfit[k])));
   const rate=row.entityType==="corporation"?a.corporateEffectiveRate:
     a.personalOrdinaryEffectiveRate;
   const tax=taxBase*rate;
   paymentMonths(row.taxYear,a.nationalTaxCashShare,tax,row.entityId,
     row.entityType==="corporation"?"corporateTax":"personalTax",taxes);
   if(remainder>0)pushCash(cash,row.entityId,ym(row.taxYear+1,a.vatSettlementMonth),
      "vatSettlement",-remainder);
   vatRows.push({entityId:row.entityId,taxYear:row.taxYear,
     registered,outputVAT:row.taxableVatOutput,
     taxableVendorVATPaid:row.vendorVatGrossPaid,
     creditClaimCandidate:candidate,creditApplied:appliedCredit,
     refundableCreditNotAssumed:Math.max(0,candidate-appliedCredit),
     estimatedCashSettlement:remainder,
     settlementMonth:ym(row.taxYear+1,a.vatSettlementMonth)});
   taxRows.push({entityId:row.entityId,entityType:row.entityType,taxYear:row.taxYear,
     categoryProfit:{...row.categoryProfit},incomeTaxBase:taxBase,
     taxableBusinessVendorVatBeforeCredit:row.vatDeductibleBeforeCredit,
     actualInputCreditAllocated:creditToBusinessTax,
     ordinaryIncomeTaxRate:rate,estimatedOrdinaryTax:tax,
     corporateSaleGain:row.corporateSaleGain});
 }
 const vatCashAdjustments=[...cash.values()].sort((x,y)=>x.month.localeCompare(y.month)||x.entityId.localeCompare(y.entityId));
 const incomeTaxCashEvents=[...taxes].map(([k,incrementalTaxCF])=>{
   const [entityId,month,taxKind]=k.split("|");
   return {entityId,month,taxKind,incrementalTaxCF};
 }).sort((a,b)=>a.month.localeCompare(b.month)||a.entityId.localeCompare(b.entityId)||a.taxKind.localeCompare(b.taxKind));
 const allIncomeTax=sum(incomeTaxCashEvents.map(x=>x.incrementalTaxCF));
 const allVat=sum(vatCashAdjustments.map(x=>x.operating));
 if(!roundTrip([allIncomeTax,allVat]))throw new RangeError("Nonfinite total indicative cash");
 return {status:"estimated",scope:"indicativeInvestorSensitivity",
   assumptions:a,unitProof,taxRows,saleRows:sales,vatRows,
   vatCashAdjustments,incomeTaxCashEvents,
   reconciliation:{incomeTaxCashTotal:allIncomeTax,netVatCashTotal:allVat,
    cashAdjustmentsTotal:allVat+allIncomeTax},
   warnings:[
    "Rates and profit classification are user-editable approximate assumptions, not tax return calculations",
    "Tax-exclusive operating cash assumption; property purchase/sale and other investing cash unchanged (assumed VAT-excluded or already gross)",
    "Residential rent VAT-exempt; all named vendor operating costs modeled as taxable suppliers; head rent exempt",
    "No automatically recognized VAT refund, project-loss refund, corporate loss carryforward or cross-income offset",
    "Building basis defaults to a visible purchase allocation assumption only if no land/building tax asset ledger exists",
    "Mixed-use utilities use forecast nights and floor share; building depreciation uses floor share and year service share; independent legal disposition basis may differ",
    "Non-recovered supplier VAT assumed deductible only on business-use component; small credits not used for refunds are not recognized",
    "VAT and income tax remittance months are forecasting conventions; amounts may differ materially from actual tax liabilities",
    "Individual salary-related additional tax, minimum taxes, residential relief, credits and legal eligibility not modeled",
    "Indicative NPV uses P04 after-tax equity discount rate; IRR computed only for unique conventional return pattern"
   ]};
}
export function appendV11IndicativeVATToLedgers({entityLedgers,vatCashAdjustments}){
 if(!Array.isArray(entityLedgers)||!Array.isArray(vatCashAdjustments))
  throw new TypeError("Estimated VAT ledgers and cash adjustments required");
 const byEntity=new Map();
 for(const l of entityLedgers){
  if(byEntity.has(l.entityId)||!Array.isArray(l.ledger?.series))
   throw new RangeError("Duplicate/malformed tax-exclusive entity ledgers");
  byEntity.set(l.entityId,new Map(l.ledger.series.map(x=>[x.month,{...x}])));
 }
 for(const a of vatCashAdjustments){
  if(!byEntity.has(a.entityId))throw new RangeError("Unknown VAT entity");
  const rows=byEntity.get(a.entityId);
  const x=rows.get(a.month)??{
    month:a.month,operating:0,investing:0,financing:0,pretaxEquityCF:0
  };
  if(x.indicativeVatCashAlreadyApplied)throw new RangeError("VAT estimate already applied");
  const v=finite(Math.abs(a.operating),"VAT operating cash adjustment")*Math.sign(a.operating);
  for(const field of ["operating","investing","financing","pretaxEquityCF"])
    if(typeof x[field]!=="number"||!Number.isFinite(x[field]))
      throw new RangeError("Base ledger has nonfinite cash");
  x.operating+=v;
  x.pretaxEquityCF+=v;
  x.indicativeVatCashAlreadyApplied=true;
  rows.set(a.month,x);
 }
 return [...byEntity].map(([entityId,m])=>({
  entityId,ledger:{series:[...m.values()].sort((x,y)=>x.month.localeCompare(y.month))}
 }));
}
