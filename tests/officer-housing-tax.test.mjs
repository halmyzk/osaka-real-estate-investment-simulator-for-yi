import test from "node:test";
import assert from "node:assert/strict";
import {calculateOfficerHousingTaxMonth,summarizeOfficerHousingTaxYear} from "../src/officer-housing-tax.mjs";
import {assessPersonalYear,assessCorporateYear,combineAnnualIncomeTaxResults} from "../src/annual-income-tax.mjs";
import {connectAnnualTaxAssessments} from "../src/income-tax-bridge.mjs";
import {evaluatePortfolio} from "../src/portfolio.mjs";
const src="https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2600.htm";
const taxSrc="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm";
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} differs from ${b}`);
const args=(month="2026-01")=>({
 corporationId:"corp",officerId:"officer",month,classification:"small",
 companyTenure:"owned",buildingUsefulLifeYears:35,totalFloorAreaSqm:99,
 buildingFixedTaxBase:2000000,landFixedTaxBase:5000000,
 officerRentPaid:0,excludedLuxuryStatus:"reviewedNotLuxury",classificationEvidenceUrl:src,
 corporateExpenseTreatment:"notBooked",bookedOfficerBenefitExpense:0
});
const meta={taxYear:2026,ruleVersion:"2026-fixture",sourceUrl:taxSrc,
 assumptionOrConfirmed:"assumption",computationMode:"standard"};
const brackets=[[1950000,.05,0],[3300000,.1,97500],[6950000,.2,427500],[9000000,.23,636000],
 [18000000,.33,1536000],[40000000,.4,2796000],[Infinity,.45,4796000]];
const personalRule={personal:{...meta,brackets,baseRounding:1000,residenceRate:.1,
 residenceBaseAdjustment:0,realEstateLossOffsetAllowed:false,businessLossOffsetAllowed:false}};
const corpRule={
 corporate:{...meta,eligibleSmallCompany:true,defenseCorporateApplies:false,
 lossOffsetEligible:true,allowNewLossCarryforward:true,lossOffsetFraction:1,
 smallBandRate:.15,standardRate:.232,smallBandAmount:8000000,defenseAllowance:5000000,localEntityCount:1},
 local:{...meta,paymentMonths:["2027-02"],
 components:[{kind:"corporateBusinessIncomeLevy",basis:"taxableIncome",rate:.05},
  {kind:"corporateResidencePerCapita",basis:"fixedAmount",fixedAmount:50000}]}
};
test("B-T12/13 NTA No.2600 small officer housing: 2m*.002+12*(99/3.3)+5m*.0022 = 15360",()=>{
 const x=calculateOfficerHousingTaxMonth(args());
 assert.equal(x.rentEquivalent,15360);
 assert.equal(x.imputedSalaryBenefit,15360);
 assert.equal(x.corporateNondeductibleAddback,0);
 assert.equal(x.status,"estimated");
});
test("B-T12 NTA No.2600 ordinary owned vs leased, and special luxury rent",()=>{
 const common={...args(),classification:"ordinary",totalFloorAreaSqm:150,
 officerRentPaid:10000,rentCashProof:{officerEntityId:"officer",corporationEntityId:"corp",
 month:"2026-01",officerPayment:-10000,corporationReceipt:10000}};
 const owned=calculateOfficerHousingTaxMonth(common);
 near(owned.rentEquivalent,(2000000*.10+5000000*.06)/12);
 const leased=calculateOfficerHousingTaxMonth({...common,companyTenure:"leased",
 landlordRentPaidByCorporation:120000});
 assert.equal(leased.rentEquivalent,60000);
 assert.equal(leased.imputedSalaryBenefit,50000);
 const luxury=calculateOfficerHousingTaxMonth({...args(),classification:"luxury",
 excludedLuxuryStatus:"reviewedLuxury",normalMarketRent:350000});
 assert.equal(luxury.imputedSalaryBenefit,350000);
});
test("B-T12 size threshold depends on building life; luxury classification cannot be assumed",()=>{
 assert.throws(()=>calculateOfficerHousingTaxMonth({...args(),totalFloorAreaSqm:100}));
 const x=calculateOfficerHousingTaxMonth({...args(),buildingUsefulLifeYears:30,totalFloorAreaSqm:132});
 assert.ok(x.rentEquivalent>0);
 assert.throws(()=>calculateOfficerHousingTaxMonth({...args(),excludedLuxuryStatus:"unknown"}));
 assert.throws(()=>calculateOfficerHousingTaxMonth({...args(),classification:"luxury",
 excludedLuxuryStatus:"reviewedLuxury",normalMarketRent:null}));
});
test("B-T14 officer rent is mirrored real cash but imputed salary is not added to cash",()=>{
 const x=calculateOfficerHousingTaxMonth({...args(),officerRentPaid:5000,
 rentCashProof:{officerEntityId:"officer",corporationEntityId:"corp",month:"2026-01",
 officerPayment:-5000,corporationReceipt:5000}});
 assert.equal(x.imputedSalaryBenefit,10360);
 assert.throws(()=>calculateOfficerHousingTaxMonth({...args(),officerRentPaid:5000}));
 assert.throws(()=>calculateOfficerHousingTaxMonth({...args(),officerRentPaid:5000,
  rentCashProof:{officerEntityId:"officer",corporationEntityId:"corp",month:"2026-01",
   officerPayment:-5000,corporationReceipt:10000}}));
});
test("B-T14 unknown corporate deductibility cannot create fictional corporate tax saving",()=>{
 const a=calculateOfficerHousingTaxMonth({...args(),corporateExpenseTreatment:"unknown",
  bookedOfficerBenefitExpense:12000});
 assert.equal(a.status,"incomplete");
 assert.equal(a.corporateNondeductibleAddback,null);
 assert.throws(()=>summarizeOfficerHousingTaxYear({corporationId:"corp",officerId:"officer",
  taxYear:2026,months:[a]}));
});
test("B-T12/13/14 monthly benefit -> annual salary and corporate addback -> incremental taxes -> dated CF",()=>{
 const months=Array.from({length:12},(_,i)=>calculateOfficerHousingTaxMonth({
  ...args(`2026-${String(i+1).padStart(2,"0")}`),
  corporateExpenseTreatment:"nonDeductibleReviewed",bookedOfficerBenefitExpense:12000
 }));
 const summary=summarizeOfficerHousingTaxYear({corporationId:"corp",officerId:"officer",
  taxYear:2026,months});
 assert.equal(summary.salaryBenefit,184320);
 assert.equal(summary.corporateAddback,144000);
 assert.deepEqual(summary.corporateTaxItems,[{entityId:"corp",taxYear:2026,category:"corporate",
  kind:"adjustment",amount:144000,source:"officerHousingNondeductibleBookedBenefit"}]);
 const person=assessPersonalYear({entityId:"officer",taxYear:2026,
  baselineTaxableIncome:3000000,projectTaxItems:[],taxRule:personalRule,
  officerSalaryBenefitWithProject:summary.salaryBenefit});
 near(person.incomeTaxDelta,18786.4);
 near(person.residenceTaxDelta,18432);
 const corp=assessCorporateYear({entityId:"corp",taxYear:2026,baselineCorporateProfit:3000000,
  projectTaxItems:summary.corporateTaxItems,openingLossesWithProject:[],
  openingLossesWithoutProject:[],taxRule:corpRule});
 near(corp.incrementalAssessment,28800);
 const both=combineAnnualIncomeTaxResults({entities:[
  {entityId:"corp",entityType:"corporation"},{entityId:"officer",entityType:"individual"}],
  years:[2026],results:[person,corp]});
 near(both.incrementalAssessment,66018.4);
 const dated=connectAnnualTaxAssessments({entities:[
  {entityId:"corp",entityType:"corporation"},{entityId:"officer",entityType:"individual"}],
  assessmentsWithProject:both.assessmentsWithProject,
  assessmentsWithoutProject:both.assessmentsWithoutProject});
 near(dated.incrementalTaxCF,-66018.4);
 assert.equal(dated.entries.find(x=>x.entityId==="corp"&&x.taxKind==="otherTax").month,"2027-02");
 assert.ok(dated.entries.some(x=>x.entityId==="officer"&&x.taxKind==="residenceTax"&&x.month==="2028-01"));
 const p=evaluatePortfolio({entityLedgers:[
  {entityId:"corp",ledger:{series:[]}},{entityId:"officer",ledger:{series:[]}}],
  baseCalendarYear:2026,holdingYears:1,taxes:dated.entries,
  taxCoverage:[{entityId:"corp",status:"estimated"},{entityId:"officer",status:"estimated"}],
  discountRate:.08});
 near(p.reconciliation.taxCashFlowTotal,-66018.4);
 assert.equal(p.annual.at(-1).year,2028);
 assert.equal(p.taxStatus,"estimated");
 // The imputed benefit affects tax ONLY; the empty pre-tax entity cash ledgers
 // remain zero, so it must not be introduced as a fake transfer.
 assert.ok(p.preTax.cashFlows.every(x=>x===0));
});
test("Deductible treatment does not double deduct, and unbooked benefit creates no expense",()=>{
 const deductible=calculateOfficerHousingTaxMonth({...args(),
  corporateExpenseTreatment:"deductibleReviewed",bookedOfficerBenefitExpense:12000});
 assert.equal(deductible.corporateNondeductibleAddback,0);
 assert.throws(()=>calculateOfficerHousingTaxMonth({...args(),bookedOfficerBenefitExpense:12000}));
});


test("B-T13 independent zero-rent statutory examples: all eligible classified officer housing is nonzero",()=>{
 const small=calculateOfficerHousingTaxMonth(args());
 const owned=calculateOfficerHousingTaxMonth({...args(),classification:"ordinary",totalFloorAreaSqm:150});
 const leased=calculateOfficerHousingTaxMonth({...args(),classification:"ordinary",totalFloorAreaSqm:150,
  companyTenure:"leased",landlordRentPaidByCorporation:120000});
 const luxury=calculateOfficerHousingTaxMonth({...args(),classification:"luxury",
  excludedLuxuryStatus:"reviewedLuxury",normalMarketRent:350000});
 near(small.imputedSalaryBenefit,15360);
 near(owned.imputedSalaryBenefit,41666.66666666667);
 near(leased.imputedSalaryBenefit,60000);
 near(luxury.imputedSalaryBenefit,350000);
 for(const x of [small,owned,leased,luxury])assert.ok(x.imputedSalaryBenefit>0);
});
