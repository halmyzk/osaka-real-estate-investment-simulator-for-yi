import test from "node:test";
import assert from "node:assert/strict";
import {assessPersonalYear,assessCorporateYear,combineAnnualIncomeTaxResults} from "../src/annual-income-tax.mjs";
import {connectAnnualTaxAssessments} from "../src/income-tax-bridge.mjs";
import {evaluatePortfolio} from "../src/portfolio.mjs";
import {depreciateAssetTimeline} from "../src/tax-rules.mjs";

const url="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm";
const brackets=[[1950000,.05,0],[3300000,.10,97500],[6950000,.20,427500],
 [9000000,.23,636000],[18000000,.33,1536000],[40000000,.40,2796000],[Infinity,.45,4796000]];
const metadata=(taxYear=2026)=>({taxYear,ruleVersion:"TEST-2026-RULE-NOT-FILING",
 sourceUrl:url,assumptionOrConfirmed:"assumption",computationMode:"standard"});
const personalRule={personal:{...metadata(),brackets,baseRounding:1000,
  residenceRate:.1,residenceBaseAdjustment:0,realEstateLossOffsetAllowed:false,
  businessLossOffsetAllowed:false}};
const corporateRule={
 corporate:{...metadata(),eligibleSmallCompany:true,defenseCorporateApplies:false,
  lossOffsetEligible:true,allowNewLossCarryforward:true,lossOffsetFraction:1,
  smallBandRate:.15,standardRate:.232,smallBandAmount:8000000,
  defenseAllowance:5000000,localEntityCount:1},
 local:{...metadata(),paymentMonths:["2027-02"],
  components:[{kind:"corporateBusinessIncomeLevy",basis:"taxableIncome",rate:.05},
   {kind:"corporateResidencePerCapita",basis:"fixedAmount",fixedAmount:50000}]}
};
const item=(entityId,category,kind,amount)=>({entityId,taxYear:2026,category,kind,amount});
const person=()=>assessPersonalYear({entityId:"person",taxYear:2026,
 baselineTaxableIncome:3000000,
 projectTaxItems:[item("person","miscellaneous","revenue",150000),
  item("person","miscellaneous","deductibleExpense",50000)],taxRule:personalRule});
const company=(dep=0)=>assessCorporateYear({entityId:"corp",taxYear:2026,
 baselineCorporateProfit:3000000,
 projectTaxItems:[item("corp","corporate","revenue",1000000),
  item("corp","corporate","depreciation",dep)],
 openingLossesWithProject:[],openingLossesWithoutProject:[],taxRule:corporateRule});

test("B-T01/02: positive miscellaneous profit applies marginal tax, losses cannot offset salary",()=>{
 const x=person();
 assert.equal(x.breakdown.miscellaneous,100000);
 assert.ok(Math.abs(x.incomeTaxDelta-10210)<1e-7);
 assert.equal(x.residenceTaxDelta,10000);
 const loss=assessPersonalYear({entityId:"person",taxYear:2026,baselineTaxableIncome:3000000,
  projectTaxItems:[item("person","miscellaneous","deductibleExpense",200000)],
  taxRule:personalRule});
 assert.equal(loss.incomeTaxDelta,0);
 assert.equal(loss.residenceTaxDelta,0);
 assert.equal(loss.individualLossOffset.unappliedLoss,200000);
});
test("B-T05/B-T23: corporate annual income includes separately configured municipal tax",()=>{
 const c=company();
 assert.equal(c.projectProfit,1000000);
 assert.equal(c.baseline.national.corporateNationalTax,450000);
 assert.equal(c.withProject.national.corporateNationalTax,600000);
 assert.equal(c.baseline.local.total,200000);
 assert.equal(c.withProject.local.total,250000);
 assert.equal(c.incrementalAssessment,200000);
 assert.deepEqual(c.assessmentsWithProject.map(x=>x.taxKind),["corporateTax","otherTax"]);
});
test("B-T10/B-T22: changing deductible use affects annual income taxes but not immediate CapEx CF",()=>{
 const asset=(use)=>depreciateAssetTimeline({id:"fixtures",category:"furniture",
 openingBookValue:12000000,acquisitionBasis:12000000,method:"straightLine",annualRate:.1,
 years:[{taxYear:2026,inServiceMonths:12,businessUseRatio:use,
  ruleBasis:"scenarioAssumption",sourceUrl:url}]});
 const a=asset(.5).rows[0],b=asset(.3).rows[0];
 assert.equal(a.grossBookReduction,b.grossBookReduction);
 assert.equal(a.deductibleDepreciation,600000);
 assert.equal(b.deductibleDepreciation,360000);
 const high=company(a.deductibleDepreciation),low=company(b.deductibleDepreciation);
 assert.ok(high.incrementalAssessment<low.incrementalAssessment);
 assert.equal(high.withProject.offset.taxableIncome,3400000);
 assert.equal(low.withProject.offset.taxableIncome,3640000);
});
test("B-T20/B-T21: assessed tax flows to 2027, with separate personal residence installments",()=>{
 const r=combineAnnualIncomeTaxResults({entities:[{entityId:"person",entityType:"individual"},
  {entityId:"corp",entityType:"corporation"}],years:[2026],results:[person(),company()]});
 assert.ok(Math.abs(r.incrementalAssessment-220210)<1e-7);
 const scheduled=connectAnnualTaxAssessments({entities:[{entityId:"person",entityType:"individual"},
  {entityId:"corp",entityType:"corporation"}],
  assessmentsWithProject:r.assessmentsWithProject,assessmentsWithoutProject:r.assessmentsWithoutProject});
 assert.ok(Math.abs(scheduled.incrementalTaxCF+220210)<1e-7);
 assert.ok(scheduled.entries.some(x=>x.entityId==="person"&&x.month==="2028-01"&&x.taxKind==="residenceTax"));
 assert.ok(scheduled.entries.some(x=>x.entityId==="corp"&&x.month==="2027-02"&&x.taxKind==="otherTax"));
 const zero={series:[]};
 const portfolio=evaluatePortfolio({entityLedgers:[{entityId:"person",ledger:zero},
  {entityId:"corp",ledger:zero}],baseCalendarYear:2026,holdingYears:1,discountRate:.08,
  taxes:scheduled.entries,taxCoverage:[{entityId:"person",status:"estimated"},{entityId:"corp",status:"estimated"}]});
 assert.equal(portfolio.annual.at(-1).year,2028);
 assert.ok(Math.abs(portfolio.reconciliation.taxCashFlowTotal+220210)<1e-7);
});
test("B-T24: missing local tax schedule, rule year or corporate loss inventories cannot silently default",()=>{
 assert.throws(()=>assessCorporateYear({entityId:"corp",taxYear:2026,
  baselineCorporateProfit:3000000,projectTaxItems:[],openingLossesWithProject:[],
  openingLossesWithoutProject:[],taxRule:{...corporateRule,local:{...corporateRule.local,paymentMonths:undefined}}}));
 assert.throws(()=>assessPersonalYear({entityId:"person",taxYear:2027,
  baselineTaxableIncome:3000000,projectTaxItems:[],taxRule:personalRule}));
 assert.throws(()=>assessCorporateYear({entityId:"corp",taxYear:2026,
  baselineCorporateProfit:3000000,projectTaxItems:[],openingLossesWithProject:[],
  taxRule:corporateRule}));
});
test("B-T05: cannot silently ignore an unassessed entity/year or misclassify corporate income",()=>{
 assert.throws(()=>combineAnnualIncomeTaxResults({entities:[{entityId:"person",entityType:"individual"},
  {entityId:"corp",entityType:"corporation"}],years:[2026],results:[person()]}));
 assert.throws(()=>assessCorporateYear({entityId:"corp",taxYear:2026,
  baselineCorporateProfit:1000000,projectTaxItems:[item("corp","miscellaneous","revenue",100000)],
  openingLossesWithProject:[],openingLossesWithoutProject:[],taxRule:corporateRule}));
});


test("B-T23 corporate loss vintages change taxable income and tax cash, not a fictitious refund",()=>{
 const loss=[{id:"loss-2024",originYear:2024,expirationYear:2034,remainingAmount:1000000}];
 const c=assessCorporateYear({entityId:"corp",taxYear:2026,baselineCorporateProfit:3000000,
   projectTaxItems:[item("corp","corporate","revenue",1000000)],
   openingLossesWithProject:loss,openingLossesWithoutProject:loss,taxRule:corporateRule});
 assert.equal(c.baseline.offset.usedLoss,1000000);
 assert.equal(c.baseline.offset.taxableIncome,2000000);
 assert.equal(c.withProject.offset.taxableIncome,3000000);
 assert.equal(c.incrementalAssessment,200000);
 assert.equal(c.withProject.offset.closingLosses.length,0);
 assert.equal(c.baseline.offset.closingLosses.length,0);
 const lossMaking=assessCorporateYear({entityId:"corp",taxYear:2026,baselineCorporateProfit:500000,
   projectTaxItems:[item("corp","corporate","deductibleExpense",700000)],
   openingLossesWithProject:[],openingLossesWithoutProject:[],taxRule:corporateRule});
 assert.equal(lossMaking.withProject.offset.taxableIncome,0);
 assert.equal(lossMaking.withProject.offset.newLoss,200000);
 assert.equal(lossMaking.withProject.offset.newLossAdded,200000);
 assert.equal(lossMaking.withProject.national.corporateNationalTax,0);
 assert.ok(lossMaking.incrementalAssessment<0);
 // The tax saving is a lower expected payment versus baseline, not an
 // automatic transfer/refund of the operating tax loss.
});
