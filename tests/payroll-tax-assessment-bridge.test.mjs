import test from "node:test";
import assert from "node:assert/strict";
import {assessPersonalYear} from "../src/annual-income-tax.mjs";
import {bridgePersonalAnnualIncomeTaxWithPayroll} from "../src/payroll-tax-assessment-bridge.mjs";
import {connectAnnualTaxAssessments} from "../src/income-tax-bridge.mjs";
const source="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm";
const brackets=[[1950000,.05,0],[3300000,.1,97500],[6950000,.2,427500],
 [9000000,.23,636000],[18000000,.33,1536000],[40000000,.4,2796000],[Infinity,.45,4796000]];
const config={personal:{taxYear:2026,ruleVersion:"fixture-2026",sourceUrl:source,
 assumptionOrConfirmed:"assumption",computationMode:"standard",brackets,baseRounding:1000,
 residenceRate:.1,residenceBaseAdjustment:0,
 realEstateLossOffsetAllowed:false,businessLossOffsetAllowed:false}};
const assessed=assessPersonalYear({entityId:"officer",taxYear:2026,
 baselineTaxableIncome:3000000,projectTaxItems:[],
 officerSalaryBenefitWithProject:100000,taxRule:config});
const income=(x)=>x.find(a=>a.taxKind==="incomeTax").amount;
const proof=(amount,id)=>({entityId:"officer",taxYear:2026,
 withholdingRemitted:true,remittedAmount:amount,sourceId:id});
test("B-T14 payroll withholding is a tax prepayment, not second income tax after assessment",()=>{
 const grossWith=income(assessed.assessmentsWithProject);
 const grossBase=income(assessed.assessmentsWithoutProject);
 const result=bridgePersonalAnnualIncomeTaxWithPayroll({personalYearAssessment:assessed,
  withheldWithProject:20000,withheldWithoutProject:5000,
  projectRemittanceEvidence:proof(20000,"paid-2026"),
  baselineRemittanceEvidence:proof(5000,"base-2026")});
 assert.equal(result.status,"estimated");
 assert.equal(income(result.assessmentsWithProject),grossWith-20000);
 assert.equal(income(result.assessmentsWithoutProject),grossBase-5000);
 const dated=connectAnnualTaxAssessments({entities:[{entityId:"officer",entityType:"individual"}],
  assessmentsWithProject:result.assessmentsWithProject,
  assessmentsWithoutProject:result.assessmentsWithoutProject});
 const grossIncomeDelta=grossWith-grossBase;
 const deltaNet=income(result.assessmentsWithProject)-income(result.assessmentsWithoutProject);
 assert.ok(Math.abs(grossIncomeDelta-((20000-5000)+deltaNet))<1e-6);
 assert.ok(Math.abs(dated.incrementalTaxCF+
  (deltaNet+assessed.residenceTaxDelta))<1e-6);
});
test("B-T24 uncertain income-tax refund must be pending, not automatically returned in annual cash",()=>{
 const x=bridgePersonalAnnualIncomeTaxWithPayroll({personalYearAssessment:assessed,
  withheldWithProject:1000000,withheldWithoutProject:0,
  projectRemittanceEvidence:proof(1000000,"excess-withheld"),
  baselineRemittanceEvidence:proof(0,"base-zero")});
 assert.equal(x.status,"incomplete");
 assert.deepEqual(x.assessmentsWithProject,[]);
 assert.equal(x.prepayment.cashPayableWithProject,null);
});
