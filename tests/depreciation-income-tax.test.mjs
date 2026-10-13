import test from "node:test";
import assert from "node:assert/strict";
import {calculateStatutoryAssetSchedule,depreciationTaxItems} from "../src/statutory-depreciation.mjs";
import {assessCorporateYear} from "../src/annual-income-tax.mjs";
import {connectAnnualTaxAssessments} from "../src/income-tax-bridge.mjs";
import {compilePretaxLedger,investingEvents} from "../src/finance.mjs";
import {evaluatePortfolio} from "../src/portfolio.mjs";
const nta="https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/5410.htm";
const metadata={taxYear:2026,ruleVersion:"illustrative-2026",sourceUrl:nta,assumptionOrConfirmed:"assumption",computationMode:"standard"};
const taxRule={
 corporate:{...metadata,eligibleSmallCompany:true,defenseCorporateApplies:false,lossOffsetEligible:true,
 allowNewLossCarryforward:true,lossOffsetFraction:1,smallBandRate:.15,standardRate:.232,
 smallBandAmount:8000000,defenseAllowance:5000000,localEntityCount:1},
 local:{...metadata,paymentMonths:["2027-02"],components:[
  {kind:"corporateBusinessIncomeLevy",basis:"taxableIncome",rate:.05},
  {kind:"corporateResidencePerCapita",basis:"fixedAmount",fixedAmount:50000}]}
};
const fullYear=calculateStatutoryAssetSchedule({
 asset:{assetId:"furniture-1",ownerEntityId:"corp",unitId:"unit-1",
  acquisitionDate:"2026-01-01",inServiceDate:"2026-01-01",category:"furniture",
  method:"straightLine",taxCategory:"corporate",acquisitionBasis:1000000,usefulLifeYears:8},
 methodRule:{version:"rate-fixture-2026",sourceUrl:nta,method:"straightLine",
  assetCategory:"furniture",eligibility:"scenarioAssumption",
  annualRate:.125,validFrom:"2026-01-01",validUntil:"2026-12-31"},
 years:[{taxYear:2026,inServiceMonths:12,businessUseShare:1,allocationEvidenceUrl:nta}]
});
test("B-T09/22 purchase 1m is invested once; tax depreciation 125k reduces assessed taxes, never cash twice",()=>{
 const taxItems=depreciationTaxItems({assetSchedules:[fullYear],taxYear:2026});
 assert.equal(taxItems[0].amount,125000);
 assert.equal(taxItems[0].noncash,true);
 const assessment=assessCorporateYear({entityId:"corp",taxYear:2026,baselineCorporateProfit:3000000,
  projectTaxItems:taxItems,openingLossesWithProject:[],openingLossesWithoutProject:[],taxRule});
 assert.equal(assessment.withProject.offset.taxableIncome,2875000);
 assert.equal(assessment.baseline.offset.taxableIncome,3000000);
 assert.equal(assessment.incrementalAssessment,-25000);
 const tax=connectAnnualTaxAssessments({
  entities:[{entityId:"corp",entityType:"corporation"}],
  assessmentsWithProject:assessment.assessmentsWithProject,
  assessmentsWithoutProject:assessment.assessmentsWithoutProject});
 assert.equal(tax.incrementalTaxCF,25000);
 const investment=investingEvents({capitalSpending:[{id:"asset-acquisition",month:"2026-01",purpose:"initial",amount:1000000}]});
 const economic=compilePretaxLedger({investing:investment});
 const result=evaluatePortfolio({entityLedgers:[{entityId:"corp",ledger:economic}],
  timeZero:[],taxes:tax.entries,taxCoverage:[{entityId:"corp",status:"estimated"}],
  baseCalendarYear:2026,holdingYears:1,discountRate:.08});
 assert.deepEqual(result.preTax.cashFlows,[0,-1000000,0]);
 assert.equal(result.afterTax.cashFlows[1],-1000000);
 assert.equal(result.afterTax.cashFlows[2],25000);
 assert.equal(result.reconciliation.afterTaxTotal,-975000);
});
test("Depreciation does not automatically create refunds from negative income or absent baseline",()=>{
 const rows=depreciationTaxItems({assetSchedules:[fullYear],taxYear:2026});
 const a=assessCorporateYear({entityId:"corp",taxYear:2026,baselineCorporateProfit:0,
  projectTaxItems:rows,openingLossesWithProject:[],openingLossesWithoutProject:[],taxRule});
 // A per-capita municipal charge in the sample remains, but there is no
 // implied cash tax refund just because this asset creates a loss.
 assert.equal(a.incrementalAssessment,0);
 assert.equal(a.withProject.offset.newLoss,125000);
 assert.equal(a.withProject.offset.taxableIncome,0);
});
