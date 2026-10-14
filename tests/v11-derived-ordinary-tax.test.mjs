import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fingerprintV11Document} from "../src/v11-income-tax-sidecar.mjs";
import {deriveV11OrdinaryTax} from "../src/v11-derived-ordinary-tax.mjs";
import {previewV11Scenario} from "../src/v11-preview-engine.mjs";
const source="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm";
const sample=JSON.parse(readFileSync(new URL("../preview/v11-sample.json",import.meta.url),"utf8"));
const clone=x=>structuredClone(x);
const f=(value,unit)=>({value,unit,sourceType:"userAssumption"});
const meta=taxYear=>({taxYear,ruleVersion:"REVIEWED-ASSUMPTION-"+taxYear,
  sourceUrl:source,computationMode:"standard",assumptionOrConfirmed:"assumption"});
const brackets=[[1950000,.05,0],[3300000,.10,97500],[6950000,.20,427500],
  [9000000,.23,636000],[18000000,.33,1536000],[40000000,.4,2796000],[Infinity,.45,4796000]];
const rules=(entityId,taxYear)=>{
 const common={entityId,taxYear,baselineEvidenceUrl:source,
   reviewStatus:"reviewedScenarioAssumption"};
 if(entityId==="person-1")return {...common,baselineTaxableIncome:2000000,
   taxRule:{personal:{...meta(taxYear),brackets,baseRounding:1000,
     residenceRate:.1,residenceBaseAdjustment:0,
     realEstateLossOffsetAllowed:false,businessLossOffsetAllowed:false}}};
 return {...common,baselineCorporateProfit:1000000,
  taxRule:{corporate:{...meta(taxYear),eligibleSmallCompany:true,
   defenseCorporateApplies:false,lossOffsetEligible:true,allowNewLossCarryforward:true,
   lossOffsetFraction:1,smallBandRate:.15,standardRate:.232,
   smallBandAmount:8000000,defenseAllowance:5000000,localEntityCount:1},
   local:{...meta(taxYear),paymentMonths:[(taxYear+1)+"-02"],components:[
    {kind:"corporateBusinessIncomeLevy",basis:"taxableIncome",rate:.05},
    {kind:"corporateResidencePerCapita",basis:"fixedAmount",fixedAmount:50000}]}}};
};
const doc=()=>{
 const d=clone(sample),u=d.units[1];
 d.units=[u,{...clone(u),id:"person-lease",name:"Personal leased M4",
   operatorEntityId:"person-1",tenantEntityId:"person-1"}];
 d.units[0].fields.A.A08.value=0;
 const p=d.units[1];
 p.fields.A.A08.value=0;
 p.fields.R.R01.value=150000;
 p.fields.A.A06.value=50000;
 return d;
};
const review=(unitId,year)=>({unitId,taxYear:year,reviewStatus:"reviewedScenarioAssumption",
 reviewEvidenceUrl:source,expenseAccrualMatchesOperations:true,
 lodgingCategory:null,rentalCategory:unitId==="person-lease"?"realEstate":"corporate",
 sharedExpenseLodgingShare:0,interestAccrualMatchesCash:true,
 interestDeductibleShare:1,interestLodgingShare:0,
 deductibleShares:{lodgingOperating:1,rentalOperating:1,propertyOperating:1,masterRent:1}});
const plan=(d,years=[2026])=>({
 version:"v11-derived-ordinary-tax-plan-1",
 documentFingerprint:fingerprintV11Document(d),
 scenarioId:"base",taxScope:"ordinaryIncomeOnly",
 vatTreatment:"notConnected",withholdingTreatment:"notModeled",
 unitYearReviews:d.units.flatMap(u=>years.map(year=>review(u.id,year))),
 entityYearRules:years.flatMap(y=>d.entities.map(e=>rules(e.id,y)))
});
const near=(x,y)=>assert.ok(Math.abs(x-y)<.000001,x+" != "+y);
test("Auto-tax actual two M4 lease units: personal real estate, corporate, annual margins -> ordinary income tax and later cash",()=>{
 const d=doc(),p=plan(d),result=previewV11Scenario(d,{derivedTaxPlan:p});
 assert.equal(result.status,"estimated-pre-tax");
 assert.equal(result.incomeTaxCalculationBasis,"derivedFromUnitOperations");
 assert.equal(result.incomeTaxStatus,"estimated");
 assert.equal(result.afterTax,null);
 assert.equal(result.taxStatus,"incomplete");
 assert.equal(result.derivedTaxUnitYearProof.length,2);
 const personal=result.derivedTaxUnitYearProof.find(x=>x.unitId==="person-lease");
 const corp=result.derivedTaxUnitYearProof.find(x=>x.unitId==="tokyo-m4");
 assert.equal(personal.rentalRevenue,1620000);
 assert.equal(personal.reviewedOperatingExpense,612000);
 assert.equal(corp.rentalRevenue,1080000);
 assert.equal(corp.reviewedOperatingExpense,612000);
 assert.ok(result.derivedTaxItems.every(x=>x.category==="realEstate"||x.category==="corporate"));
 const personalTaxableNet=result.derivedTaxItems.filter(x=>x.entityId==="person-1")
  .reduce((s,x)=>s+(x.kind==="revenue"?x.amount:-x.amount),0);
 assert.equal(personalTaxableNet,1008000);
 const corpTaxableNet=result.derivedTaxItems.filter(x=>x.entityId==="corporation-1")
  .reduce((s,x)=>s+(x.kind==="revenue"?x.amount:-x.amount),0);
 assert.equal(corpTaxableNet,468000);
 const tax=sum=>result.incomeTaxCashEvents.filter(x=>x.month===sum)
  .reduce((a,x)=>a+x.incrementalTaxCF,0);
 near(tax("2027-02"),-93600);
 near(tax("2027-03"),-102916.8);
 near(tax("2028-01"),-25200);
 near(result.incomeTaxCashEvents.reduce((a,x)=>a+x.incrementalTaxCF,0),-297316.8);
 assert.equal(result.annualIncomeTaxSensitivity.at(-1).year,2028);
 assert.ok(result.afterIncomeTaxSensitivity.NPV<result.preTax.NPV);
});
test("Nonmatching input/scenario, missing review, and guessed individual expense categories block automatic tax",()=>{
 const d=doc(),p=plan(d);
 assert.equal(deriveV11OrdinaryTax({document:d,scenarioId:"upside",unitResults:[],taxPlan:p}).status,"incomplete");
 const stale=clone(d);stale.units[1].fields.R.R01.value+=1;
 const changed=previewV11Scenario(stale,{derivedTaxPlan:p});
 assert.equal(changed.incomeTaxStatus,"incomplete");
 assert.equal(changed.afterIncomeTaxSensitivity,null);
 const absent=clone(p);absent.unitYearReviews.pop();
 assert.match(previewV11Scenario(d,{derivedTaxPlan:absent}).incomeTaxBlocker,/Missing unit-year/);
 const unknown=clone(p);unknown.unitYearReviews[1].rentalCategory="miscellaneous";
 assert.match(previewV11Scenario(d,{derivedTaxPlan:unknown}).incomeTaxBlocker,/Nondefault/);
 const noRules=clone(p);noRules.entityYearRules.pop();
 assert.match(previewV11Scenario(d,{derivedTaxPlan:noRules}).incomeTaxBlocker,/missing/);
});
test("Owned land/building sale cannot be misclassified as ordinary revenue or automatic taxable income",()=>{
 const d=clone(sample);
 const p=plan(d);p.unitYearReviews=[review("osaka-m3",2026),review("tokyo-m4",2026)];
 p.documentFingerprint=fingerprintV11Document(d);
 const res=previewV11Scenario(d,{derivedTaxPlan:p});
 assert.equal(res.incomeTaxStatus,"incomplete");
 assert.match(res.incomeTaxBlocker,/Owned property requires separate land\/building basis/);
 assert.equal(res.afterTax,null);
});
test("No automatic tax on lease setup capital payments until amortization/tax basis assessed",()=>{
 const d=doc();d.units[0].fields.A.A08.value=20000;
 const p=plan(d);
 const res=previewV11Scenario(d,{derivedTaxPlan:p});
 assert.match(res.incomeTaxBlocker,/Capital\/lease setup payment/);
});
test("Approved year-specific tax rules: multi-year annual data, cash after exit and investment horizon",()=>{
 const d=doc();
 d.portfolio.holdingYears=2;
 for(const u of d.units)u.exit.exitDate="2027-12-31";
 const p=plan(d,[2026,2027]);
 const r=previewV11Scenario(d,{derivedTaxPlan:p});
 assert.equal(r.incomeTaxStatus,"estimated");
 assert.equal(r.derivedTaxUnitYearProof.length,4);
 assert.deepEqual(r.annualIncomeTaxSensitivity.map(x=>x.year),[2026,2027,2028,2029]);
 assert.ok(r.incomeTaxCashEvents.some(x=>x.month==="2029-01"&&x.taxKind==="residenceTax"));
 assert.ok(r.derivedTaxItems.some(x=>x.taxYear===2027&&x.entityId==="person-1"));
 assert.equal(r.afterTax,null);
});
test("Reviewed loan interest can be deductible once, but principal/draw/financing fee never is",()=>{
 const d=doc();d.units[0].loans=[{id:"loan",borrowerEntityId:"corporation-1",
  drawDate:"2026-01-01",principal:600000,annualInterestRate:12,
  termMonths:12,repaymentMethod:"equalPrincipal"}];
 const p=plan(d);
 const result=previewV11Scenario(d,{derivedTaxPlan:p});
 assert.equal(result.incomeTaxStatus,"estimated");
 const r=result.derivedTaxUnitYearProof.find(x=>x.unitId==="tokyo-m4");
 assert.ok(r.interestPaid>0);near(r.interestPaid,r.reviewedDeductibleInterest);
 const rows=result.derivedTaxItems.filter(x=>x.sourceLine==="reviewedAccruedInterestRental");
 assert.equal(rows.length,1);near(rows[0].amount,r.interestPaid);
 const ignored=clone(p);ignored.unitYearReviews[0].interestAccrualMatchesCash=false;
 const blocked=previewV11Scenario(d,{derivedTaxPlan:ignored});
 assert.equal(blocked.incomeTaxStatus,"incomplete");
 assert.match(blocked.incomeTaxBlocker,/Cash interest requires/);
 const fees=clone(d);fees.units[0].loans[0].fees=1000;
 const feePlan=plan(fees);
 assert.match(previewV11Scenario(fees,{derivedTaxPlan:feePlan}).incomeTaxBlocker,/Financing fee/);
});
