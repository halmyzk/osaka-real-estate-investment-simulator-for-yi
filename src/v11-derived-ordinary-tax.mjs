/**
 * Gate A -> Gate B: restricted, auditable automatic ORDINARY income-tax path.
 *
 * Converts ACTUAL calculated unit/month operating results + actual debt interest
 * into category-specific annual tax items. Income tax is then calculated by
 * the EXISTING assessPersonalYear / assessCorporateYear rule engines.
 *
 * Owned M4 full-business real-estate is supported only by a reviewed
 * land/building tax register, noncash straight-line building depreciation
 * and separate individual capital gain or corporate disposal gain.
 * Other owned models, capital additions/finance fees, private use,
 * withholding, VAT invoice cash, non-January fiscal years and unsettled
 * classification are deliberately blocked.
 * Missing tax inputs block the output; a blank input never means zero tax.
 *
 * All tax rules and expense/business shares are separately supplied reviewed
 * scenario assumptions. "estimated" is NOT tax filing certification.
 */
import {fingerprintV11Document} from "./v11-income-tax-sidecar.mjs";
import {assessPersonalYear,assessCorporateYear,combineAnnualIncomeTaxResults} from "./annual-income-tax.mjs";
import {connectAnnualTaxAssessments} from "./income-tax-bridge.mjs";
import {deriveOwnedM4TaxRegister} from "./v11-owned-property-tax.mjs";

const num=(v,k,{min=-Infinity,max=Infinity}={})=>{
 if(typeof v!=="number"||!Number.isFinite(v)||v<min||v>max)
   throw new RangeError(k+" must be a finite number in range");
 return v;
};
const text=(v,k)=>{if(typeof v!=="string"||!v)throw new TypeError(k+" required");return v;};
const ratio=(v,k)=>num(v,k,{min:0,max:1});
const sum=rows=>rows.reduce((total,x)=>total+x,0);
const reason=(message,more={})=>({status:"incomplete",reason:message,
 taxItems:[],annualAssessments:[],incomeTaxEvents:[],...more});
const groupBy=(arr,k)=>{const m=new Map();for(const x of arr){const id=k(x);
 const list=m.get(id)??[];list.push(x);m.set(id,list);}return m;};
const ownedModes=new Set(["own"]);
const categorySuggestion=(unit,entity,stream)=>{
 if(entity.taxpayerType==="corporation")return "corporate";
 if(stream==="lodging")return unit.modelId==="M1"?"business":"miscellaneous";
 return "realEstate";
};
const categories=new Set(["corporate","business","realEstate","miscellaneous"]);
const moneyColumns=["lodgingOperating","rentalOperating","propertyOperating","masterRent"];
const key=(id,year)=>id+"|"+year;
const signedReconcile=(items)=>items.reduce((total,x)=>total+(x.kind==="revenue"?x.amount:
 x.kind==="deductibleExpense"||x.kind==="depreciation"?-x.amount:x.amount),0);
function buildTaxItems(document,unitResults,plan){
 const byUnit=new Map(document.units.map(u=>[u.id,u]));
 const entities=new Map(document.entities.map(e=>[e.id,e]));
 const expectedReview=new Map();
 const ownedRegisters=[],ownedTaxReviews=plan.ownedPropertyReviews??[];
 if(!Array.isArray(ownedTaxReviews))throw new RangeError("Owned property reviews must be an array");
 const ownedById=new Map();
 for(const r of ownedTaxReviews){
  if(!r?.unitId||ownedById.has(r.unitId))
    throw new RangeError("Duplicate/unknown owned-property review ID");
  ownedById.set(r.unitId,r);
 }
 for(const u of unitResults){
   const stored=byUnit.get(u.unitId);
   if(!stored||!entities.has(u.entityId)||stored.operatorEntityId!==u.entityId)
     throw new RangeError("operating tax source entity or unit references invalid");
   if(stored.tenure==="own"){
     if(plan.taxScope!=="ordinaryAndOwnedSale"||!ownedById.has(stored.id))
       throw new RangeError("Owned property requires separate land/building basis, depreciation and disposal tax computation, with reviewed evidence");
     const reg=deriveOwnedM4TaxRegister({
        unit:stored,unitResult:u,ownerType:entities.get(u.entityId).taxpayerType,
        ownedReview:ownedById.get(stored.id)});
     ownedRegisters.push(reg);
   }else if(stored.tenure==="lease"){
     if(stored.assets?.length)
       throw new RangeError("Leased asset depreciation not yet linked to automatic income-tax route");
   }else throw new RangeError("Unknown unit tenure");
   if(stored.tenure==="lease"&&ownedById.has(stored.id))
     throw new RangeError("Leased unit cannot claim owned property review");
   if((stored.expenses??[]).some(x=>x.taxTreatment!=="deductible"||
      x.businessUseRatio!==undefined&&x.businessUseRatio!==100))
      throw new RangeError("Partial or non-deductible explicit expense needs item-level allocation");
   if(u.investing.some(x=>["initialCapEx","expansionCapEx","maintenanceCapEx"].includes(x.category)&&x.amount!==0)||
      stored.tenure==="lease"&&u.investing.some(x=>x.category==="acquisitionPrice"&&x.amount!==0))
     throw new RangeError("Capital/lease setup payment requires reviewed amortization/depreciation schedule");
   if(u.financing.some(x=>["financingFee"].includes(x.category)&&x.amount!==0))
     throw new RangeError("Financing fee requires separately reviewed tax treatment");
   const years=new Set(u.operating.map(x=>Number(x.month.slice(0,4))));
   for(const y of years)expectedReview.set(key(u.unitId,y),{unit:u,stored,entity:entities.get(u.entityId),year:y});
 }
 if(ownedById.size!==ownedRegisters.length)
   throw new RangeError("Owned property review has no matching computed owned unit");
 const reviews=plan.unitYearReviews;
 if(!Array.isArray(reviews))throw new TypeError("Reviewed unit-year classification array required");
 const provided=new Map();
 for(const r of reviews){
   const k=key(r?.unitId,r?.taxYear);
   if(provided.has(k)||!expectedReview.has(k))throw new RangeError("Duplicate or nonoperating unit-year review "+k);
   provided.set(k,r);
 }
 for(const k of expectedReview.keys())if(!provided.has(k))
   throw new RangeError("Missing unit-year tax classification review "+k);
 const taxItems=[],proof=[];
 const add=(entityId,taxYear,category,kind,amount,label,unitId)=>{
   const v=num(amount,label,{min:0});
   if(v===0)return;
   taxItems.push({entityId,taxYear,category,kind,amount:v,
      sourceUnitId:unitId,sourceLine:label});
 };
 for(const [k,context] of expectedReview){
   const {unit,stored,entity,year}=context;
   const r=provided.get(k);
   if(r.reviewStatus!=="reviewedScenarioAssumption"||
      !r.reviewEvidenceUrl?.startsWith("https://")||
      r.expenseAccrualMatchesOperations!==true)
     throw new RangeError("Expense classification and income accrual require explicit review: "+k);
   const shares=r.deductibleShares;
   if(!shares||typeof shares!=="object")
     throw new RangeError("All expense eligibility ratios required: "+k);
   for(const col of moneyColumns)ratio(shares[col],col+" deductible share "+k);
   const op=unit.operating.filter(x=>Number(x.month.slice(0,4))===year);
   const sumColumn=fn=>op.reduce((total,x)=>total+num(fn(x.result),"operating tax input"),0);
   const lodgingRevenue=sumColumn(x=>x.lodging.revenue);
   const rentalRevenue=sumColumn(x=>x.rental.revenue);
   const amounts=Object.fromEntries(moneyColumns.map(col=>
     [col,sumColumn(x=>x.expenses[col])]));
   const hasLodging=op.some(x=>x.result.lodging.allocatedDays>0);
   const hasRental=op.some(x=>x.result.rental.allocatedDays>0);
   const lodgingCategory=hasLodging?r.lodgingCategory:null;
   const rentalCategory=hasRental?r.rentalCategory:null;
   for(const [stream,active,cat] of [["lodging",hasLodging,lodgingCategory],["rental",hasRental,rentalCategory]]){
     if(active){
       if(!categories.has(cat)||entity.taxpayerType==="individual"&&cat==="corporate"||
          entity.taxpayerType==="corporation"&&cat!=="corporate")
          throw new RangeError("Invalid taxpayer income category "+stream+" "+k);
       if(cat!==categorySuggestion(stored,entity,stream)&&r.alternativeClassificationReviewed!==true)
          throw new RangeError("Nondefault income category requires external review "+k);
     }else if((stream==="lodging"?r.lodgingCategory:r.rentalCategory)!==null)
       throw new RangeError("Income category must be null for absent stream "+k);
   }
   const sharedShare=hasLodging&&hasRental?
     ratio(r.sharedExpenseLodgingShare,"sharedExpenseLodgingShare "+k):hasLodging?1:0;
   if(!hasLodging&&!hasRental)throw new RangeError("Unit lacks taxable operating stream");
   const interest=unit.financing.filter(e=>Number(e.month.slice(0,4))===year&&e.category==="interest")
      .reduce((t,e)=>t-num(e.amount,"interest cash"),0);
   if(interest<0)throw new RangeError("Cash interest paid is negative");
   if(interest>0&&r.interestAccrualMatchesCash!==true)
      throw new RangeError("Cash interest requires independently reviewed tax accrual "+k);
   const interestDeductibleShare=interest>0?ratio(r.interestDeductibleShare,"interest deductibility "+k):0;
   const interestLodgingShare=interest>0&&hasLodging&&hasRental?
      ratio(r.interestLodgingShare,"interest category allocation "+k):sharedShare;
   add(unit.entityId,year,lodgingCategory,"revenue",lodgingRevenue,"lodgingRevenue",unit.unitId);
   add(unit.entityId,year,rentalCategory,"revenue",rentalRevenue,"rentalRevenue",unit.unitId);
   add(unit.entityId,year,lodgingCategory??rentalCategory,"deductibleExpense",
     amounts.lodgingOperating*shares.lodgingOperating,"lodgingOperating",unit.unitId);
   add(unit.entityId,year,rentalCategory??lodgingCategory,"deductibleExpense",
     amounts.rentalOperating*shares.rentalOperating,"rentalOperating",unit.unitId);
   for(const type of ["propertyOperating","masterRent"]){
     const deductible=amounts[type]*shares[type];
     add(unit.entityId,year,lodgingCategory??rentalCategory,"deductibleExpense",
       deductible*sharedShare,type+"LodgingAllocated",unit.unitId);
     add(unit.entityId,year,rentalCategory??lodgingCategory,"deductibleExpense",
       deductible*(1-sharedShare),type+"RentalAllocated",unit.unitId);
   }
   const taxableInterest=interest*interestDeductibleShare;
   add(unit.entityId,year,lodgingCategory??rentalCategory,"deductibleExpense",
      taxableInterest*interestLodgingShare,"reviewedAccruedInterestLodging",unit.unitId);
   add(unit.entityId,year,rentalCategory??lodgingCategory,"deductibleExpense",
      taxableInterest*(1-interestLodgingShare),"reviewedAccruedInterestRental",unit.unitId);
   const reviewedExpense=moneyColumns.reduce((t,c)=>t+amounts[c]*shares[c],0);
   const grossExpense=moneyColumns.reduce((t,c)=>t+amounts[c],0);
   proof.push({unitId:unit.unitId,entityId:unit.entityId,taxYear:year,
     lodgingCategory,rentalCategory,lodgingRevenue,rentalRevenue,
     cashOperatingExpense:grossExpense,reviewedOperatingExpense:reviewedExpense,
     excludedOperatingExpense:grossExpense-reviewedExpense,
     interestPaid:interest,reviewedDeductibleInterest:taxableInterest,
     categoryAllocationReviewed:true,sourceUrl:r.reviewEvidenceUrl,
     arithmeticCheck:Math.abs(
        sum(taxItems.filter(x=>x.sourceUnitId===unit.unitId&&x.taxYear===year&&x.kind==="revenue").map(x=>x.amount))-
        (lodgingRevenue+rentalRevenue))<1e-6});
 }
 const personalSales=ownedRegisters.map(x=>x.individualSaleAssessment).filter(Boolean);
 for(const register of ownedRegisters){
   taxItems.push(...register.ordinaryDepreciationItems,...register.corporateGainItems);
 }
 return {taxItems,proof,ownedRegisters,personalSales};
}
export function deriveV11OrdinaryTax({document,scenarioId,unitResults,taxPlan}){
 if(taxPlan===null||taxPlan===undefined)return reason("Reviewed income tax calculation plan not provided");
 if(document?.schemaVersion!=="1.1.0"||!Array.isArray(document.entities)||
   !Array.isArray(unitResults))throw new TypeError("v1.1 portfolio and completed unit results required");
 if(taxPlan.version!=="v11-derived-ordinary-tax-plan-1"||
    taxPlan.documentFingerprint!==fingerprintV11Document(document)||
    taxPlan.scenarioId!==scenarioId)
   return reason("Tax calculation plan does not match document fingerprint or scenario");
 if(!["ordinaryIncomeOnly","ordinaryAndOwnedSale"].includes(taxPlan.taxScope)||
    taxPlan.vatTreatment!=="notConnected"||
    taxPlan.withholdingTreatment!=="notModeled")
   return reason("Only explicitly VAT- and withholding-excluded ordinary-income scenarios supported");
 if(!/^\d{4}-01-01$/.test(document.portfolio?.baseDate)||!Number.isInteger(document.portfolio?.holdingYears)||
    document.portfolio.holdingYears<1)
   return reason("January-based holding calendar required");
 const entities=document.entities;
 if(entities.some(e=>(e.taxYearStartMonth??1)!==1||
   e.otherIncome?.length||e.taxPayments?.length||e.lossCarryforwards?.length))
   return reason("Other income, prior tax payments or opening losses require separate counterfactual review");
 let source;
 try{source=buildTaxItems(document,unitResults,taxPlan);}
 catch(e){return reason("Tax source derivation blocked: "+e.message);}
 const years=Array.from({length:document.portfolio.holdingYears},(_,i)=>
   Number(document.portfolio.baseDate.slice(0,4))+i);
 const pairs=new Map();
 for(const row of taxPlan.entityYearRules??[]){
   const k=key(row?.entityId,row?.taxYear);
   if(pairs.has(k)||!entities.some(e=>e.id===row?.entityId)||!years.includes(row.taxYear))
     return reason("Unknown or duplicate tax rule entity-year "+k);
   pairs.set(k,row);
 }
 if(pairs.size!==entities.length*years.length)
   return reason("Tax baseline and tax rules missing for one or more entities/years");
 let results=[];
 const closingLosses=new Map();
 for(const year of years){
   for(const entity of entities){
     const r=pairs.get(key(entity.id,year));
     if(!r||r.reviewStatus!=="reviewedScenarioAssumption"||
       !r.baselineEvidenceUrl?.startsWith("https://"))
       return reason("Tax baseline lacks reviewed provenance "+key(entity.id,year));
     const projectTaxItems=source.taxItems.filter(x=>x.entityId===entity.id&&x.taxYear===year);
     try{
       if(entity.taxpayerType==="individual"){
         num(r.baselineTaxableIncome,"baselineTaxableIncome",{min:0});
         const row=assessPersonalYear({
           entityId:entity.id,taxYear:year,
           baselineTaxableIncome:r.baselineTaxableIncome,projectTaxItems,taxRule:r.taxRule,
           officerSalaryBenefitWithProject:0,officerSalaryBenefitWithoutProject:0
         });
         results.push(row);
       }else if(entity.taxpayerType==="corporation"){
         num(r.baselineCorporateProfit,"baselineCorporateProfit");
         const last=closingLosses.get(entity.id);
         const openingWith=last?.withProject??[];
         const openingWithout=last?.withoutProject??[];
         if(r.openingLossesWithProject!==undefined||r.openingLossesWithoutProject!==undefined)
           return reason("Direct opening-loss input not reviewed by this route");
         const row=assessCorporateYear({
           entityId:entity.id,taxYear:year,
           baselineCorporateProfit:r.baselineCorporateProfit,
           projectTaxItems,taxRule:r.taxRule,
           openingLossesWithProject:openingWith,openingLossesWithoutProject:openingWithout
         });
         closingLosses.set(entity.id,{
            withProject:row.withProject.offset.closingLosses,
            withoutProject:row.baseline.offset.closingLosses
         });
         results.push(row);
       }else return reason("Unsupported entity taxpayer type");
     }catch(e){return reason("Tax assessment rule incomplete "+key(entity.id,year)+": "+e.message);}
   }
 }
 let assessment;
 try{
   assessment=combineAnnualIncomeTaxResults({
     entities:entities.map(e=>({entityId:e.id,entityType:e.taxpayerType})),
     years,results
   });
   const saleWith=source.personalSales;
   const saleWithout=source.personalSales.map(x=>({...x,amount:0}));
   const allWith=[...assessment.assessmentsWithProject,...saleWith];
   const allWithout=[...assessment.assessmentsWithoutProject,...saleWithout];
   const taxCash=connectAnnualTaxAssessments({
      entities:entities.map(e=>({entityId:e.id,entityType:e.taxpayerType})),
      assessmentsWithProject:allWith,
      assessmentsWithoutProject:allWithout
   });
   return {status:"estimated",calculationBasis:"derivedFromUnitOperations",
     taxYears:years,taxItems:source.taxItems,
     unitYearProof:source.proof,yearlyAssessmentResults:results,
     ownedAssetTaxRegisters:source.ownedRegisters,
     withProject:allWith,
     withoutProject:allWithout,
     incomeTaxEvents:taxCash.entries,incrementalTaxCF:taxCash.incrementalTaxCF,
     warnings:[
       "Income tax estimates are computed from actual scenario operating results, with separately reviewed income categories and expense shares",
       "Owned M4 land/building tax only when a full reviewed asset/sale plan exists; mixed personal use, other asset additions, taxable VAT and tax refunds remain unsupported",
       "Baseline income, local rates, tax-year rule eligibility and deductible interest are reviewed modeling assumptions",
       "Tax cash dates are forecast scheduling rules; refunds are not automatically remitted"
     ]};
 }catch(e){return reason("Tax assessment/cash reconciliation blocked: "+e.message);}
}
