import test from "node:test";
import assert from "node:assert/strict";
import {calculateMixedUseIndividualSaleBasis} from "../src/personal-sale-basis.mjs";
import {landBuildingSaleGain} from "../src/tax.mjs";
import {individualSaleGainTax} from "../src/tax-detail.mjs";
import {assessPersonalYear,assessCorporateYear,combineAnnualIncomeTaxResults} from "../src/annual-income-tax.mjs";
import {connectAnnualTaxAssessments} from "../src/income-tax-bridge.mjs";
import {verifyAssessmentCoverage} from "../src/tax-integrity.mjs";
import {assessOfficerResidenceException} from "../src/officer-housing-exceptions.mjs";
import {assessResidentialBuildingVATLaterAdjustment,computeVATWithReviewedResidentialAdjustment} from "../src/vat-building-adjustment.mjs";
import {compileVATInclusiveCash,attachVATCashToEntityLedgers} from "../src/vat-cash.mjs";
import {auditInterEntityTransfers} from "../src/reconciliation.mjs";
import {evaluatePortfolio} from "../src/portfolio.mjs";

const NTA2108="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2108_qa.htm";
const NTA3208="https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3208.htm";
const NTA2600="https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2600.htm";
const META_URL="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm";
const VAT_URL="https://www.nta.go.jp/publication/pamph/shohi/r02kaisei.pdf";
const brackets=[[1950000,.05,0],[3300000,.1,97500],[6950000,.2,427500],
 [9000000,.23,636000],[18000000,.33,1536000],
 [40000000,.4,2796000],[Infinity,.45,4796000]];
const metadata=y=>({taxYear:y,ruleVersion:"scenario-"+y,sourceUrl:META_URL,
 assumptionOrConfirmed:"assumption",computationMode:"standard"});
const personalRule=y=>({personal:{...metadata(y),brackets,baseRounding:1000,residenceRate:.1,
 residenceBaseAdjustment:0,realEstateLossOffsetAllowed:false,businessLossOffsetAllowed:false}});
const corporateRule=y=>({
 corporate:{...metadata(y),eligibleSmallCompany:true,defenseCorporateApplies:false,
 lossOffsetEligible:true,allowNewLossCarryforward:true,lossOffsetFraction:1,
 smallBandRate:.15,standardRate:.232,smallBandAmount:8000000,
 defenseAllowance:5000000,localEntityCount:1},
 local:{...metadata(y),paymentMonths:[(y+1)+"-02"],
 components:[{kind:"corporateBusinessIncomeLevy",basis:"taxableIncome",rate:.05},
 {kind:"corporateResidencePerCapita",basis:"fixedAmount",fixedAmount:50000}]}
});
const taxItem=(year,kind,amount)=>({entityId:"corp",taxYear:year,
 category:"corporate",kind,amount});
const near=(a,b)=>assert.ok(Math.abs(a-b)<.001,`${a} != ${b}`);

test("Multi-entity 2026-27 sale/housing/VAT/ordinary tax -> cash years 2026-29 without duplicate internal salary",()=>{
 // PERSON: private period 2016-2023; verified business period through sale 2026.
 const business=[2023,2024,2025,2026].map((year,i)=>({
  taxYear:year,ownerEntityId:"person",sourceAssetId:"private-then-business",
  grossBookReduction:i===0?472500:500000,
  businessDeduction:i===0?236250:250000,
  reviewedForDisposalBasis:true,evidenceUrl:NTA2108
 }));
 const basis=calculateMixedUseIndividualSaleBasis({
  buildingId:"private-then-business",ownerEntityId:"person",
  acquiredAt:"2016-01-10",convertedAt:"2023-04-01",soldAt:"2026-10-01",
  fiscalYearEndMonth:12,buildingAcquisitionCost:10000000,
  statutoryUsefulLifeYears:22,oldStraightLineUsefulLifeYears:33,
  oldStraightLineRate:.031,
  rule:{sourceUrl:NTA2108,version:"NTA-2108",basis:"reviewedScenario"},
  businessDepreciationLedger:business,consecutiveBusinessCoverageReviewed:true
 });
 assert.equal(basis.adjustedBuildingBasis,6074500);
 const sale=landBuildingSaleGain({ownerType:"individual",purchaseDate:"2016-01-10",
  saleDate:"2026-10-01",proceeds:20000000,sellingCosts:1000000,
  adjustedLandBasis:5000000,adjustedBuildingBasis:basis.adjustedBuildingBasis});
 assert.equal(sale.taxableGain,7925500);
 const gainsTax=individualSaleGainTax({taxYear:2026,taxableGain:sale.taxableGain,
  holdingClass:sale.holdingClass,reconstructionRate:.021,defenseIncomeRate:0,
  ruleSourceUrl:NTA3208});
 near(gainsTax.totalTaxBeforeRounding,1610065.325);

 // PERSON: noncash use of corporation's small dwelling, then actual cash
 // housing allowance (not fictional corporate-housing rent) in 2027.
 const person2026=assessPersonalYear({entityId:"person",taxYear:2026,
  baselineTaxableIncome:3000000,projectTaxItems:[],
  officerSalaryBenefitWithProject:184320,taxRule:personalRule(2026)});
 const cashAllowance=assessOfficerResidenceException({
  corporationId:"corp",officerId:"person",month:"2027-03",
  arrangement:{kind:"cashHousingAllowance",contractTenant:"person",employerHousingPayment:50000},
  payrollCashProof:{corporationId:"corp",month:"2027-03",amount:50000,cashAlreadyInLedger:true},
  arrangementEvidenceUrl:NTA2600
 });
 assert.equal(cashAllowance.newOperatingCash,0);
 const person2027=assessPersonalYear({entityId:"person",taxYear:2027,
  baselineTaxableIncome:3000000,projectTaxItems:[],
  officerSalaryBenefitWithProject:cashAllowance.additionalSalaryForTax,
  taxRule:personalRule(2027)});
 near(person2026.incomeTaxDelta+person2026.residenceTaxDelta,37218.4);
 near(person2027.incomeTaxDelta+person2027.residenceTaxDelta,10105);

 // CORPORATION: 2026 and 2027 rental profits, minus paid salary in 2027.
 const corp2026=assessCorporateYear({entityId:"corp",taxYear:2026,
  baselineCorporateProfit:0,projectTaxItems:[taxItem(2026,"revenue",100000)],
  openingLossesWithProject:[],openingLossesWithoutProject:[],taxRule:corporateRule(2026)});
 const corp2027=assessCorporateYear({entityId:"corp",taxYear:2027,
  baselineCorporateProfit:0,projectTaxItems:[
   taxItem(2027,"revenue",200000),taxItem(2027,"deductibleExpense",50000)],
  openingLossesWithProject:[],openingLossesWithoutProject:[],taxRule:corporateRule(2027)});
 assert.equal(corp2026.incrementalAssessment,20000);
 assert.equal(corp2027.incrementalAssessment,30000);

 const combined=combineAnnualIncomeTaxResults({
  entities:[{entityId:"person",entityType:"individual"},{entityId:"corp",entityType:"corporation"}],
  years:[2026,2027],results:[person2026,person2027,corp2026,corp2027]
 });
 const saleRecord=y=>({id:"sale-person-"+y,entityId:"person",taxYear:y,
  taxKind:"saleGainTax",amount:y===2026?gainsTax.totalTaxBeforeRounding:0,
  status:"estimated",ruleVersion:"NTA-3208-"+y,sourceUrl:NTA3208});
 const withProject=[...combined.assessmentsWithProject,saleRecord(2026),saleRecord(2027)];
 const withoutProject=[...combined.assessmentsWithoutProject,
  {...saleRecord(2026),amount:0},saleRecord(2027)];
 const coverage=verifyAssessmentCoverage({
  entities:[{entityId:"person"},{entityId:"corp"}],assessmentYears:[2026,2027],
  requiredKinds:{person:["incomeTax","residenceTax","saleGainTax"],
   corp:["corporateTax","otherTax"]},
  withProject,withoutProject
 });
 assert.equal(coverage.eligibleForTaxCashBridge,true);
 const tax=connectAnnualTaxAssessments({
  entities:[{entityId:"person",entityType:"individual"},{entityId:"corp",entityType:"corporation"}],
  assessmentsWithProject:withProject,assessmentsWithoutProject:withoutProject});
 near(tax.incrementalTaxCF,-1707388.725);

 // CORPORATE VAT: NTA residential building SOLD earlier. The assessment
 // includes separately supported historic output/input VAT; no refund.
 const restriction=assessResidentialBuildingVATLaterAdjustment({
  assetId:"previously-disposed-corp-building",entityId:"corp",
  acquiredAt:"2023-04-01",thirdTaxPeriodEnd:"2026-03-31",
  taxPeriodEnd:"2026-03-31",eventType:"disposed",eventDate:"2025-12-01",
  reviewedLegalEligibility:"reviewedEligible",heldAtThirdPeriodEnd:false,
  restrictedAcquisitionVAT:1000,taxableRentalConsideration:0,
  exemptRentalConsideration:800,buildingDisposalConsideration:7200,
  ruleVersion:"NTA-2020-pamphlet",sourceReference:VAT_URL
 });
 assert.equal(restriction.inputVATCreditAdjustment,900);
 const vat=computeVATWithReviewedResidentialAdjustment({
  entityId:"corp",taxPeriodEnd:"2026-03-31",
  outputVAT:1200,ordinaryEligibleInputVAT:200,
  residentialAdjustments:[restriction]});
 assert.equal(vat.paymentDue,100);
 const grossVATLedger=compileVATInclusiveCash({
  lines:[{id:"rent-2026",entityId:"corp",month:"2026-10",kind:"sale",
   netAmount:100000,vatAmount:0,vatClass:"exempt",cashGrossAmount:100000},
   {id:"rent-2027",entityId:"corp",month:"2027-10",kind:"sale",
   netAmount:200000,vatAmount:0,vatClass:"exempt",cashGrossAmount:200000}],
  taxSettlements:[{id:"confirmed-2026-vat",entityId:"corp",month:"2026-05",
   kind:"payment",amount:vat.paymentDue}],
  taxCoverage:[{entityId:"corp",status:"estimated"}]
 });
 const corpLedgers=attachVATCashToEntityLedgers({
  baseLedgers:[{entityId:"corp",ledger:{series:[
   {month:"2027-03",operating:-50000,investing:0,financing:0,pretaxEquityCF:-50000}
  ]}}],
  vatBridge:grossVATLedger,provenance:"netPnlExcludedFromCash"
 });
 // Salary transfer is economically internal and must have both cash legs.
 const payroll=auditInterEntityTransfers({
  entityIds:["corp","person"],
  transfers:[{id:"salary-2027",month:"2027-03",category:"housingAllowance",
   fromEntityId:"corp",toEntityId:"person",amount:50000}],
  ledgerLines:[{id:"corp-salary",entityId:"corp",month:"2027-03",
   category:"housingAllowance",amount:-50000,internalTransferId:"salary-2027"},
   {id:"person-salary",entityId:"person",month:"2027-03",
   category:"housingAllowance",amount:50000,internalTransferId:"salary-2027"}]
 });
 assert.equal(payroll.internalNetCash,0);
 const personLedger={series:[
  {month:"2026-10",operating:0,investing:19000000,financing:0,pretaxEquityCF:19000000},
  {month:"2027-03",operating:50000,investing:0,financing:0,pretaxEquityCF:50000}
 ]};
 const p=evaluatePortfolio({entityLedgers:[{entityId:"person",ledger:personLedger},...corpLedgers],
  baseCalendarYear:2026,holdingYears:2,discountRate:.08,
  taxes:tax.entries,
  taxCoverage:[{entityId:"person",status:"estimated"},{entityId:"corp",status:"estimated"}]});
 assert.equal(p.annual[0].year,2026);
 assert.equal(p.annual.at(-1).year,2029); // 2027 residence tax fourth installment
 near(p.reconciliation.taxCashFlowTotal,-1707388.725);
 // VAT is already included in the pre-income-tax ledger once, hence no
 // double subtraction in incremental income-tax events.
 near(p.reconciliation.preTaxTotal,19300000-100);
 near(p.reconciliation.afterTaxTotal,19300000-100-1707388.725);
 assert.equal(p.taxStatus,"estimated");
});
