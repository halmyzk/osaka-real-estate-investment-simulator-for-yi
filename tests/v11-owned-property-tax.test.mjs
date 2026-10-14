import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {previewV11Scenario} from "../src/v11-preview-engine.mjs";
import {fingerprintV11Document} from "../src/v11-income-tax-sidecar.mjs";
import {deriveOwnedM4TaxRegister,ownedPropertyPrimarySources} from "../src/v11-owned-property-tax.mjs";

const load=n=>JSON.parse(readFileSync(new URL("../preview/"+n,import.meta.url),"utf8"));
const original=load("v11-sample.json"),basePlan=load("v11-derived-tax-plan-example.json");
const clone=x=>structuredClone(x);
const f=(value,unit)=>({value,unit,sourceType:"userAssumption"});
const approximate=(a,b)=>assert.ok(Math.abs(a-b)<=1e-6,`${a} !== ${b}`);

function fixture({corporateOwner=false}={}){
 const d=clone(original),u=d.units[0],corp=d.units[1];
 u.modelId="M4";
 u.name="Owned M4 with reviewed tax basis";
 if(corporateOwner){u.operatorEntityId="corporation-1";u.ownerEntityId="corporation-1";}
 u.tenantEntityId=null;
 delete u.fields.H;
 u.fields.R={R01:f(100000,"JPY_per_month"),R02:f(90,"percent")};
 u.calendar=[];
 u.exit.priceGrowthRate=20;
 u.exit.sellingCosts=10000;
 u.assets=[
  {id:"land",ownerEntityId:u.ownerEntityId,category:"land",
   grossCost:400000,taxBasis:400000,taxBookValue:400000,
   invoiceDate:"2026-01-01",inServiceDate:"2026-01-01",disposalDate:"2026-12-31",
   usefulLifeYears:null,depreciationMethod:"nonDepreciable",
   businessUseRatioByYear:[{year:2026,ratio:100}],privateUseAdjustment:"notApplicable"},
  {id:"building",ownerEntityId:u.ownerEntityId,category:"building",
   grossCost:600000,taxBasis:600000,taxBookValue:600000,
   invoiceDate:"2026-01-01",inServiceDate:"2026-01-01",disposalDate:"2026-12-31",
   usefulLifeYears:20,depreciationMethod:"straightLine",
   businessUseRatioByYear:[{year:2026,ratio:100}],privateUseAdjustment:"notApplicable"}
 ];
 corp.fields.A.A08.value=0;
 const p=clone(basePlan);
 p.version="v11-derived-ordinary-tax-plan-1";
 p.taxScope="ordinaryAndOwnedSale";
 p.unitYearReviews=[
  {unitId:"osaka-m3",taxYear:2026,reviewStatus:"reviewedScenarioAssumption",
   reviewEvidenceUrl:ownedPropertyPrimarySources.dep,
   expenseAccrualMatchesOperations:true,
   lodgingCategory:null,rentalCategory:corporateOwner?"corporate":"realEstate",
   sharedExpenseLodgingShare:0,interestAccrualMatchesCash:true,
   interestDeductibleShare:1,interestLodgingShare:0,
   deductibleShares:{lodgingOperating:1,rentalOperating:1,propertyOperating:1,masterRent:1}},
  ...basePlan.unitYearReviews.filter(x=>x.unitId==="tokyo-m4")
 ];
 p.ownedPropertyReviews=[{
  unitId:"osaka-m3",reviewStatus:"reviewedScenarioAssumption",
  reviewedTaxBasis:true,costAllocationSourceUrl:ownedPropertyPrimarySources.dep,
  assetRates:{building:{
    rate:.05,minimumResidualValue:1,usefulLifeReviewed:true,
    eligibilityReviewed:true,sourceUrl:ownedPropertyPrimarySources.dep,
    version:"TEST-2026-STRAIGHTLINE-20Y"
  }},
  saleReview:{
    reviewStatus:"reviewedScenarioAssumption",eligibleRelief:false,
    exitCostsDeductibleReviewed:true,saleProceedsMatchCash:true,
    grossPriceReviewed:1200000,sellingCostsReviewed:10000,
    salePriceSourceUrl:ownedPropertyPrimarySources.gain,
    individual:corporateOwner?undefined:{
      taxRateEligibilityReviewed:true,rateSourceUrl:ownedPropertyPrimarySources.short,
      ruleVersion:"TEST-2026-SHORT-GAIN",
      reconstructionRate:.021,defenseIncomeRate:0,
      nationalPaymentMonth:"2027-03",
      residencePaymentMonths:["2027-06","2027-08","2027-10","2028-01"]
    }
  }
 }];
 p.documentFingerprint=fingerprintV11Document(d);
 return {d,p,u};
}
test("Owned personal M4: acquisition cash once, tax land nondepreciable, building -30,000 annual noncash and exit taxable gain 220,000",()=>{
 const {d,p}=fixture();
 const report=previewV11Scenario(d,{scenarioId:"base",derivedTaxPlan:p});
 assert.equal(report.status,"estimated-pre-tax");
 assert.equal(report.incomeTaxStatus,"estimated",report.incomeTaxBlocker??"");
 assert.equal(report.afterTax,null);
 assert.equal(report.taxStatus,"incomplete");
 const owned=report.ownedAssetTaxRegisters[0];
 assert.equal(owned.status,"estimated");
 assert.equal(owned.acquisitionCash,1000000);
 assert.equal(owned.grossSaleCash,1200000);
 assert.equal(owned.disposalCosts,10000);
 assert.equal(owned.taxBookValueAtExit,970000);
 assert.equal(owned.saleGain.gain,220000);
 assert.equal(owned.saleGain.holdingClass,"short");
 assert.equal(owned.assetLines.find(x=>x.category==="land").annual[0].grossBookReduction,0);
 const building=owned.assetLines.find(x=>x.category==="building");
 assert.equal(building.annual[0].grossBookReduction,30000);
 assert.equal(building.annual[0].deductibleDepreciation,30000);
 assert.equal(building.saleClosingBookValue,570000);
 assert.equal(report.derivedTaxItems.filter(x=>x.sourceLine==="buildingTaxDepreciation").length,1);
 assert.equal(report.derivedTaxItems.filter(x=>x.sourceLine==="buildingTaxDepreciation")[0].amount,30000);
 assert.equal(report.CF0,-1100000); // 1m purchase + 100k corporate deposit; lease fee is 0.
});
test("Owned individual short gain tax appears as March national + following year resident installments, not rental income",()=>{
 const {d,p}=fixture();
 const r=previewV11Scenario(d,{derivedTaxPlan:p});
 assert.equal(r.incomeTaxStatus,"estimated",r.incomeTaxBlocker??"");
 const owned=r.ownedAssetTaxRegisters[0];
 approximate(owned.individualSaleAssessment.amount,87186);
 assert.deepEqual(owned.individualSaleAssessment.paymentMonths,
   ["2027-03","2027-06","2027-08","2027-10","2028-01"]);
 assert.deepEqual(r.annualIncomeTaxSensitivity.map(x=>x.year),[2026,2027,2028]);
 const saleTax=r.incomeTaxCashEvents.filter(x=>x.taxKind==="saleGainTax");
 assert.equal(saleTax.length,5);
 approximate(saleTax.reduce((a,x)=>a+x.incrementalTaxCF,0),-87186);
 assert.ok(saleTax.some(x=>x.month==="2028-01"&&x.incrementalTaxCF===-4950));
 assert.equal(r.derivedTaxItems.some(x=>x.sourceLine==="reviewedCorporateAssetDisposalGain"),false);
 assert.equal(r.derivedTaxItems.filter(x=>x.entityId==="person-1"&&x.kind==="revenue")
   .reduce((a,x)=>a+x.amount,0),1080000);
});
test("Corporate owned M4: disposal gain is one corporate-tax revenue adjustment, never separate personal capital-gain tax",()=>{
 const {d,p}=fixture({corporateOwner:true});
 const r=previewV11Scenario(d,{derivedTaxPlan:p});
 assert.equal(r.incomeTaxStatus,"estimated",r.incomeTaxBlocker??"");
 const owned=r.ownedAssetTaxRegisters[0];
 assert.equal(owned.saleGain.gain,220000);
 assert.equal(owned.saleGain.holdingClass,"corporateIncome");
 assert.equal(owned.individualSaleAssessment,null);
 const gain=r.derivedTaxItems.filter(x=>x.sourceLine==="reviewedCorporateAssetDisposalGain");
 assert.equal(gain.length,1);
 assert.equal(gain[0].amount,220000);
 assert.equal(gain[0].taxYear,2026);
 assert.equal(r.incomeTaxCashEvents.some(x=>x.taxKind==="saleGainTax"),false);
 assert.equal(r.taxStatus,"incomplete");
});
test("Missing register/asset, private use, basis mismatch and unreviewed statutory rate do not generate investor after-tax returns",()=>{
 const {d,p}=fixture();
 const cases=[
  q=>{q.p.ownedPropertyReviews=[]},
  q=>{q.d.units[0].assets=[];q.p.documentFingerprint=fingerprintV11Document(q.d)},
  q=>{q.d.units[0].assets[1].businessUseRatioByYear[0].ratio=80;q.p.documentFingerprint=fingerprintV11Document(q.d)},
  q=>{q.p.ownedPropertyReviews[0].assetRates.building.eligibilityReviewed=false},
  q=>{q.d.units[0].assets[1].taxBasis=590000;q.p.documentFingerprint=fingerprintV11Document(q.d)},
  q=>{q.p.ownedPropertyReviews[0].saleReview.grossPriceReviewed=1500000}
 ];
 for(const edit of cases){
   const scenario={d:clone(d),p:clone(p)};edit(scenario);
   const r=previewV11Scenario(scenario.d,{derivedTaxPlan:scenario.p});
   assert.equal(r.incomeTaxStatus,"incomplete",JSON.stringify(scenario.p.ownedPropertyReviews));
   assert.equal(r.afterIncomeTaxSensitivity,null);
   assert.equal(r.afterTax,null);
 }
});
test("Cannot double charge land/building as CapEx, or bypass review by claiming an owned asset as lease improvement",()=>{
 const {d,p}=fixture();
 const before=previewV11Scenario(d);
 assert.equal(before.CF0,-1100000);
 assert.equal(before.units[0].investing.filter(x=>x.category==="acquisitionPrice").length,1);
 assert.equal(before.units[0].investing.some(x=>x.category==="initialCapEx"),false);
 const inflated=clone(d);inflated.units[0].assets[0].grossCost+=10;
 assert.throws(()=>previewV11Scenario(inflated),/reconcile exactly to A01/);
 const mixed=clone(d);mixed.units[0].assets.push({...mixed.units[0].assets[0],id:"extra"});
 assert.throws(()=>previewV11Scenario(mixed),/one land and one building/);
});

test("Unreviewed residential relief is rejected before portfolio tax model can hide it",()=>{
 const {d,p}=fixture();
 d.units[0].exit.applyResidentialRelief=true;
 p.documentFingerprint=fingerprintV11Document(d);
 assert.throws(()=>previewV11Scenario(d,{derivedTaxPlan:p}),/sale tax relief requires reviewed/);
});


test("B-T22 book depreciation is noncash: changing reviewed rate changes tax not pre-tax investment cash",()=>{
 const {d,p}=fixture();
 const a=previewV11Scenario(d,{derivedTaxPlan:p});
 const other=clone(p);
 other.ownedPropertyReviews[0].assetRates.building.rate=.04;
 other.ownedPropertyReviews[0].assetRates.building.version="REVIEWED-20-YEAR-ALTERNATE-RATE-FIXTURE";
 const b=previewV11Scenario(d,{derivedTaxPlan:other});
 assert.deepEqual(a.preTax.cashFlows,b.preTax.cashFlows);
 assert.equal(a.CF0,b.CF0);
 assert.equal(a.ownedAssetTaxRegisters[0].saleGain.gain,220000);
 assert.equal(b.ownedAssetTaxRegisters[0].saleGain.gain,214000);
 assert.equal(b.ownedAssetTaxRegisters[0].taxBookValueAtExit,976000);
 assert.equal(a.derivedTaxItems.find(x=>x.sourceLine==="buildingTaxDepreciation").amount,30000);
 assert.equal(b.derivedTaxItems.find(x=>x.sourceLine==="buildingTaxDepreciation").amount,24000);
 assert.notEqual(a.afterIncomeTaxSensitivity.NPV,b.afterIncomeTaxSensitivity.NPV);
});
test("Exit restoration liability, closing costs and non-new asset service date must be explicitly tax-reviewed",()=>{
 const {d,p}=fixture();
 const restore=clone(d);
 restore.units[0].exit.exitObligations=50000;
 const plan=clone(p);plan.documentFingerprint=fingerprintV11Document(restore);
 assert.match(previewV11Scenario(restore,{derivedTaxPlan:plan}).incomeTaxBlocker,/exit obligation/);
 const closing=clone(d);
 closing.units[0].fields.A.A02={value:50000,unit:"JPY",sourceType:"userAssumption"};
 const pClosing=clone(p);pClosing.documentFingerprint=fingerprintV11Document(closing);
 assert.match(previewV11Scenario(closing,{derivedTaxPlan:pClosing}).incomeTaxBlocker,/closing cost/);
 const notNew=clone(d);
 notNew.units[0].assets[1].inServiceDate="2026-03-01";
 const pNew=clone(p);pNew.documentFingerprint=fingerprintV11Document(notNew);
 assert.match(previewV11Scenario(notNew,{derivedTaxPlan:pNew}).incomeTaxBlocker,/in-service/);
});
test("Owned M3 self-use and unreviewed sale loss cannot flow through full-business M4 pilot",()=>{
 const {d,p}=fixture();
 const m3=clone(d);
 m3.units[0].modelId="M3";
 m3.units[0].calendar=Array.from({length:12},(_,i)=>{
  const month=i+1,days=new Date(Date.UTC(2026,month,0)).getUTCDate();
  return {year:2026,month,lodgingDays:15,rentalDays:0,selfUseDays:days-15,
   changeoverDays:0,idleDays:0};
 });
 m3.units[0].fields.H={H01:{value:20000,unit:"JPY_per_room_night",sourceType:"userAssumption"},
  H02:{value:50,unit:"percent",sourceType:"userAssumption"}};
 const m3Plan=clone(p);m3Plan.documentFingerprint=fingerprintV11Document(m3);
 assert.match(previewV11Scenario(m3,{derivedTaxPlan:m3Plan}).incomeTaxBlocker,/owned M4/);
 const loss=clone(d);
 loss.units[0].exit.priceGrowthRate=-10;
 const lossPlan=clone(p);
 lossPlan.ownedPropertyReviews[0].saleReview.grossPriceReviewed=900000;
 lossPlan.documentFingerprint=fingerprintV11Document(loss);
 assert.match(previewV11Scenario(loss,{derivedTaxPlan:lossPlan}).incomeTaxBlocker,/Sale loss offset eligibility/);
});
