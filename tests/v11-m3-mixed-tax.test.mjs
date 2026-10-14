import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {allocateBusinessExpense} from "../src/tax.mjs";
import {previewV11Scenario} from "../src/v11-preview-engine.mjs";
import {fingerprintV11Document} from "../src/v11-income-tax-sidecar.mjs";
import {inspectV11Draft} from "../src/v11-draft-storage.mjs";
import {deriveOwnedM3MixedTaxRegister} from "../src/v11-owned-m3-mixed-tax.mjs";
const load=name=>JSON.parse(readFileSync(new URL("../preview/"+name,import.meta.url),"utf8"));
const source=load("v11-m3-mixed-use-sample.json");
const tax=load("v11-m3-mixed-tax-plan.json");
const clone=x=>structuredClone(x);
const near=(x,y)=>assert.ok(Math.abs(x-y)<1e-6,`${x} != ${y}`);
const evaluate=(d=source,p=tax)=>previewV11Scenario(d,{scenarioId:"base",derivedTaxPlan:p});
test("M3 mixed-use saved document and reviewed sidecar match actual canonical v1.1 shape",()=>{
 assert.equal(inspectV11Draft(source).status,"structurallyReviewed");
 assert.equal(fingerprintV11Document(source),tax.documentFingerprint);
 assert.equal(source.units[0].modelId,"M3");
 assert.equal(source.units[0].tenure,"own");
 assert.equal(source.units[0].calendar.reduce((s,x)=>s+x.lodgingDays,0),180);
 assert.equal(source.units[0].assets.length,2);
 assert.equal(source.units[0].expenses.length,12);
});
test("M3 180 calendar lodging days vs 54 forecast nights vs 365 building-business days: annual utility and building income-tax treatment",()=>{
 const x=evaluate();
 assert.equal(x.status,"estimated-pre-tax");
 assert.equal(x.incomeTaxStatus,"estimated",x.incomeTaxBlocker);
 assert.equal(x.taxStatus,"incomplete");
 assert.equal(x.afterTax,null);
 assert.equal(x.CF0,-1100000);
 assert.equal(x.preTax.cashFlows[1],2598000);
 assert.equal(x.ownedAssetTaxRegisters.length,1);
 const register=x.ownedAssetTaxRegisters[0];
 assert.equal(register.modelId,"M3");
 assert.equal(register.annualUse.length,1);
 const y=register.annualUse[0];
 assert.equal(y.lodgingAllocatedDays,180);
 assert.equal(y.forecastSoldNights,54);
 assert.equal(y.calendarDays,365);
 near(y.sharedUtilityExpenseShare,.6*54/365);
 near(y.buildingBusinessShare,.6);
 assert.notEqual(y.sharedUtilityExpenseShare,180/365);
 assert.equal(register.assetLines.find(a=>a.category==="land").annual[0].grossBookReduction,0);
 const b=register.assetLines.find(a=>a.category==="building");
 assert.equal(b.annual[0].grossBookReduction,30000);
 assert.equal(b.annual[0].deductibleDepreciation,18000);
 near(register.disposalEvidence.businessBookReduction,18000);
 near(register.disposalEvidence.nonbusinessBookReduction,12000);
 near(register.disposalEvidence.deductibleBusinessExpenseHistory,18000);
 assert.equal(register.disposalEvidence.adjustedBuildingBasis,570000);
 assert.equal(register.taxBookValueAtExit,970000);
 assert.equal(register.saleGain.gain,220000);
 assert.equal(register.saleGain.holdingClass,"short");
 near(register.individualSaleAssessment.amount,87186);
 near(register.reconciliation.operatingDeductedVsDisposalBusinessHistory,0);
 const expense=x.derivedTaxItems.filter(a=>a.entityId==="person-1"&&a.sourceLine==="propertyOperatingLodgingAllocated");
 assert.equal(expense.length,1);
 near(expense[0].amount,240000*.6*54/365);
 const dep=x.derivedTaxItems.filter(a=>a.sourceLine==="buildingTaxDepreciation");
 assert.equal(dep.length,1);
 assert.equal(dep[0].category,"miscellaneous");
 assert.equal(dep[0].amount,18000);
 const gainTax=x.incomeTaxCashEvents.filter(a=>a.taxKind==="saleGainTax");
 assert.equal(gainTax.length,5);
 near(gainTax.reduce((s,a)=>s+a.incrementalTaxCF,0),-87186);
 assert.ok(gainTax.some(a=>a.month==="2028-01"));
});
test("B-T06 independent utility allocation is 19,726.027.. for 240000 x 60/180 x 90/365, not 180 days",()=>{
 const actual=allocateBusinessExpense({expense:240000,method:"areaGuestNights",
   areaBusiness:60,areaTotal:180,actualGuestNights:90,daysInYear:365});
 near(actual.amount,19726.027397260274);
 assert.equal(Math.round(actual.amount),19726);
 const wrongly=allocateBusinessExpense({expense:240000,method:"areaGuestNights",
   areaBusiness:60,areaTotal:180,actualGuestNights:180,daysInYear:365});
 assert.ok(wrongly.amount>actual.amount*1.9);
 const building=allocateBusinessExpense({expense:30000,method:"areaBusinessPeriod",
   areaBusiness:60,areaTotal:180,businessDays:365,daysInYear:365});
 near(building.amount,10000);
});
test("Scenario edits or alternate scenario invalidate reviewed actual-night and monthly sale tax plan",()=>{
 const changed=clone(source);changed.units[0].fields.H.H02.value=60;
 const stale=evaluate(changed,tax);
 assert.equal(stale.incomeTaxStatus,"incomplete");
 assert.equal(stale.afterIncomeTaxSensitivity,null);
 const up=previewV11Scenario(source,{scenarioId:"upside",derivedTaxPlan:tax});
 assert.equal(up.incomeTaxStatus,"incomplete");
 assert.equal(up.afterIncomeTaxSensitivity,null);
 const p=clone(tax);p.unitYearReviews.find(r=>r.unitId==="osaka-m3").deductibleShares.propertyOperating=180/365;
 const x=evaluate(source,p);
 assert.equal(x.incomeTaxStatus,"incomplete");
 assert.match(x.incomeTaxBlocker,/guest nights|utility/i);
});
test("M3 disposal basis cannot be inferred from operating depreciation: monthly records are required and reconcile with deduction",()=>{
 for(const alter of [
  p=>p.ownedPropertyReviews[0].disposalBasisReview.monthlyRecords.pop(),
  p=>p.ownedPropertyReviews[0].disposalBasisReview.monthlyRecords[0].nonbusinessGrossEquivalent=-1,
  p=>p.ownedPropertyReviews[0].disposalBasisReview.monthlyRecords[0].businessActualDeducted=100,
  p=>p.ownedPropertyReviews[0].disposalBasisReview.use90PercentException=true,
  p=>p.ownedPropertyReviews[0].disposalBasisReview.monthlyRecords[0].businessShare=.5,
  p=>p.ownedPropertyReviews[0].yearUseReviews[0].forecastGuestNights=180,
  p=>p.ownedPropertyReviews[0].yearUseReviews[0].businessSupplyDays=180,
  p=>p.ownedPropertyReviews[0].sharedUtilityExpenseReviews.pop(),
  p=>p.ownedPropertyReviews[0].sharedUtilityExpenseReviews[0].reviewedGrossCashAmount=1,
  p=>p.ownedPropertyReviews[0].assetRates.building.eligibilityReviewed=false
 ]){
  const p=clone(tax);alter(p);
  const x=evaluate(source,p);
  assert.equal(x.incomeTaxStatus,"incomplete",x.incomeTaxBlocker);
  assert.equal(x.afterIncomeTaxSensitivity,null);
  assert.equal(x.afterTax,null);
 }
});
test("Changing reviewed business area modifies ordinary depreciation without mutating any pre-tax investor acquisition or operating cash",()=>{
 const original=evaluate();
 const alternative=clone(tax);
 const r=alternative.ownedPropertyReviews[0].yearUseReviews[0];
 r.businessFloorArea=50;
 for(const asset of source.units[0].assets){
  // Asset tax-use history is part of canonical saved document, so use a
  // matched, newly fingerprinted alternate document too.
 }
 const d=clone(source);
 d.units[0].assets.forEach(a=>a.businessUseRatioByYear[0].ratio=50);
 alternative.documentFingerprint=fingerprintV11Document(d);
 alternative.unitYearReviews.find(x=>x.unitId==="osaka-m3")
    .deductibleShares.propertyOperating=.5*54/365;
 const dep=alternative.ownedPropertyReviews[0].disposalBasisReview.monthlyRecords;
 for(const m of dep){
  m.businessShare=.5;m.privateShare=.5;
  m.businessGrossEquivalent=1250;
  m.nonbusinessGrossEquivalent=1250;
  m.businessActualDeducted=1250;
 }
 const revised=evaluate(d,alternative);
 assert.equal(revised.incomeTaxStatus,"estimated",revised.incomeTaxBlocker);
 assert.deepEqual(original.preTax.cashFlows,revised.preTax.cashFlows);
 assert.equal(original.CF0,revised.CF0);
 assert.equal(original.ownedAssetTaxRegisters[0].assetLines[1].annual[0].deductibleDepreciation,18000);
 assert.equal(revised.ownedAssetTaxRegisters[0].assetLines[1].annual[0].deductibleDepreciation,15000);
 near(revised.derivedTaxItems.find(x=>x.sourceLine==="propertyOperatingLodgingAllocated").amount,
   240000*.5*54/365);
 assert.notEqual(original.afterIncomeTaxSensitivity.NPV,revised.afterIncomeTaxSensitivity.NPV);
});
test("M3 cannot silently treat unreviewed renovation, other private cost or corporation's self-use as individual M3",()=>{
 const d=clone(source);
 d.units[0].assets.push({...clone(d.units[0].assets[0]),id:"unclassified-extra"});
 assert.throws(()=>previewV11Scenario(d),/one land and one building/);
 const withPrivate=clone(source);
 withPrivate.units[0].expenses[0].allocationMethod="private";
 const plan=clone(tax);plan.documentFingerprint=fingerprintV11Document(withPrivate);
 const x=evaluate(withPrivate,plan);
 assert.equal(x.incomeTaxStatus,"incomplete");
 assert.match(x.incomeTaxBlocker,/utility expenses/);
 const corp=clone(source);
 corp.units[0].operatorEntityId="corporation-1";
 corp.units[0].ownerEntityId="corporation-1";
 corp.units[0].assets.forEach(a=>a.ownerEntityId="corporation-1");
 corp.units[0].expenses.forEach(a=>a.entityId="corporation-1");
 const q=clone(tax);q.documentFingerprint=fingerprintV11Document(corp);
 assert.equal(evaluate(corp,q).incomeTaxStatus,"incomplete");
});

test("Developer preview exposes two-step explicit M3 sample and tax-plan controls, never claims final VAT-inclusive tax",()=>{
 const html=readFileSync(new URL("../preview/v11-dev.html",import.meta.url),"utf8");
 for(const id of ["choose-m3-demo","load-m3-demo-tax","owned-tax-register"])
   assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/v11-m3-mixed-use-sample\.json/);
 assert.match(html,/v11-m3-mixed-tax-plan\.json/);
 assert.match(html,/forecastSoldNights/);
 assert.match(html,/sharedUtilityExpenseShare/);
 assert.match(html,/buildingBusinessShare/);
 assert.match(html,/nonbusinessBookReduction/);
 assert.match(html,/正式な税引後NPV／IRR/);
});

test("M3 multi-year 2028 leap calendar: different 365/366 expense denominator, year-end disposal basis and 2030 post-sale tax cash",()=>{
 const d=clone(source),p=clone(tax);
 d.portfolio.holdingYears=3;
 for(const unit of d.units){
   unit.exit.exitDate="2028-12-31";
   if(unit.modelId==="M3"){
     for(const a of unit.assets){
       a.disposalDate="2028-12-31";
       a.businessUseRatioByYear=[2026,2027,2028].map(year=>({year,ratio:60}));
     }
     for(const year of [2027,2028]){
       for(const c of source.units[0].calendar){
         const days=new Date(Date.UTC(year,c.month,0)).getUTCDate();
         unit.calendar.push({...c,year,selfUseDays:days-c.lodgingDays});
       }
       for(const expense of source.units[0].expenses){
         const month=Number(expense.periodStart.slice(5,7));
         const mo=year+"-"+String(month).padStart(2,"0");
         const monthEnd=String(new Date(Date.UTC(year,month,0)).getUTCDate()).padStart(2,"0");
         unit.expenses.push({...expense,id:"shared-utilities-"+mo,
           periodStart:mo+"-01",periodEnd:mo+"-"+monthEnd,cashDate:mo+"-"+monthEnd});
       }
     }
   }
 }
 const review=p.ownedPropertyReviews[0];
 for(const year of [2027,2028]){
    const yr=year===2028?366:365;
    review.yearUseReviews.push({
      ...clone(review.yearUseReviews[0]),taxYear:year,
      businessSupplyDays:yr,forecastGuestNights:90
    });
    for(let i=0;i<12;i++){
      const mo=year+"-"+String(i+1).padStart(2,"0");
      review.sharedUtilityExpenseReviews.push({
        ...clone(review.sharedUtilityExpenseReviews[i]),expenseId:"shared-utilities-"+mo
      });
      review.disposalBasisReview.monthlyRecords.push({
        ...clone(review.disposalBasisReview.monthlyRecords[i]),
        month:year+"-"+String(i+1).padStart(2,"0")
      });
    }
    for(const base of tax.unitYearReviews){
      p.unitYearReviews.push({
        ...clone(base),taxYear:year,
        deductibleShares:{...base.deductibleShares,
          propertyOperating:base.unitId==="osaka-m3"?.6*90/yr:1}
      });
    }
    for(const entity of tax.entityYearRules){
      const row=clone(entity);row.taxYear=year;
      for(const rule of Object.values(row.taxRule)){
        rule.taxYear=year;
        if(rule.paymentMonths)rule.paymentMonths=[(year+1)+"-02"];
      }
      p.entityYearRules.push(row);
    }
 }
 review.saleReview.grossPriceReviewed=1000000*(1.2**3);
 // Cash settlement dates and surtax labels must follow the actual sale tax
 // year. The 2026 fictional example's dates/rules cannot be reused in 2028.
 review.saleReview.individual.nationalPaymentMonth="2029-03";
 review.saleReview.individual.residencePaymentMonths=["2029-06","2029-08","2029-10","2030-01"];
 review.saleReview.individual.reconstructionRate=.011;
 review.saleReview.individual.defenseIncomeRate=.01;
 review.saleReview.individual.ruleVersion="FICTIONAL-2028-RECONSTRUCTION-AND-DEFENSE";
 p.documentFingerprint=fingerprintV11Document(d);
 const result=evaluate(d,p);
 assert.equal(result.incomeTaxStatus,"estimated",result.incomeTaxBlocker);
 assert.equal(result.ownedAssetTaxRegisters.length,1);
 const m3=result.ownedAssetTaxRegisters[0];
 assert.deepEqual(m3.annualUse.map(x=>x.calendarDays),[365,365,366]);
 assert.deepEqual(m3.annualUse.map(x=>x.forecastSoldNights),[54,90,90]);
 near(m3.annualUse[1].sharedUtilityExpenseShare,.6*90/365);
 near(m3.annualUse[2].sharedUtilityExpenseShare,.6*90/366);
 assert.equal(m3.assetLines[1].annual.length,3);
 assert.equal(m3.assetLines[1].annual.reduce((z,x)=>z+x.deductibleDepreciation,0),54000);
 assert.equal(m3.disposalEvidence.businessBookReduction,54000);
 assert.equal(m3.disposalEvidence.nonbusinessBookReduction,36000);
 assert.equal(m3.disposalEvidence.adjustedBuildingBasis,510000);
 near(m3.saleGain.gain,808000);
 assert.ok(result.incomeTaxCashEvents.some(x=>x.taxKind==="saleGainTax"&&x.month==="2030-01"));
 assert.equal(result.afterTax,null);
});
