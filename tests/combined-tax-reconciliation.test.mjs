import test from "node:test";
import assert from "node:assert/strict";
import {reconcileConcurrentUseSaleBasis} from "../src/mixed-use-sale-basis.mjs";
import {landBuildingSaleGain} from "../src/tax.mjs";
import {individualSaleGainTax} from "../src/tax-detail.mjs";
import {compileOfficerPayrollMonth,reconcileAnnualPayrollPrepayment} from "../src/officer-payroll-withholding.mjs";
import {reviewVATTaxpayerPeriod,reconcileVATAssessmentAndSettlement} from "../src/vat-taxpayer-settlement.mjs";
import {compileVATInclusiveCash,attachVATCashToEntityLedgers} from "../src/vat-cash.mjs";
import {connectAnnualTaxAssessments} from "../src/income-tax-bridge.mjs";
import {auditInterEntityTransfers} from "../src/reconciliation.mjs";
import {evaluatePortfolio} from "../src/portfolio.mjs";
const ntabasis="https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3261.htm";
const ntavats="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6501.htm";
const ntaGen="https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2511.htm";
const ntaGain="https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3208.htm";
const approximate=(a,b)=>assert.ok(Math.abs(a-b)<.001,`${a} != ${b}`);
test("Gate B cross-entity mixed-use disposal, payroll prepayment, VAT actual settlement and post-exit CF",()=>{
 const months=Array.from({length:12},(_,i)=>({
  month:"2026-"+String(i+1).padStart(2,"0"),
  businessShare:.4,privateShare:.6,
  businessGrossEquivalent:2000,nonbusinessGrossEquivalent:1000,
  businessActualDeducted:1200,
  reviewedDisposalTreatment:true,evidenceUrl:ntabasis
 }));
 const basis=reconcileConcurrentUseSaleBasis({buildingId:"house",ownerEntityId:"person",
  acquiredAt:"2026-01-01",soldAt:"2026-12-31",acquisitionBasis:1000000,
  monthlyRecords:months,splitCalculationReviewed:true,dispositionExclusionReviewed:true,
  ruleVersion:"reviewed-2026-fixture"});
 assert.equal(basis.adjustedBuildingBasis,964000);
 const sale=landBuildingSaleGain({ownerType:"individual",purchaseDate:"2026-01-01",
  saleDate:"2026-12-31",proceeds:2000000,sellingCosts:100000,
  adjustedLandBasis:100000,adjustedBuildingBasis:basis.adjustedBuildingBasis});
 assert.equal(sale.taxableGain,836000);
 const capitalTax=individualSaleGainTax({taxYear:2026,holdingClass:"short",
  taxableGain:836000,reconstructionRate:.021,defenseIncomeRate:0,ruleSourceUrl:ntaGain});
 approximate(capitalTax.totalTaxBeforeRounding,331306.8);
 const salary=compileOfficerPayrollMonth({
  payrollId:"2026-officer",employerEntityId:"corp",officerEntityId:"person",
  month:"2026-06",cashSalaryGross:100000,noncashHousingBenefit:15000,
  employeeSocialInsurance:0,withholdingTax:10000,
  withholdingRemittanceMonth:"2026-07",socialRemittanceMonth:"2026-07",
  employerExpenseDeductibility:"reviewedDeductible",
  taxTableEvidence:{taxYear:2026,version:"assumed-2026",payPeriod:"monthly",
   tableColumn:"ko",lookupStatus:"scenarioAssumption",sourceUrl:ntaGen,
   taxableMonthlyBase:115000,withholdingAmount:10000}
 });
 assert.equal(salary.employeeCashReceipt,90000);
 const wageProof=auditInterEntityTransfers({
  entityIds:["corp","person"],transfers:[{id:"2026-officer",month:"2026-06",
   category:"wageNet",fromEntityId:"corp",toEntityId:"person",amount:90000}],
  ledgerLines:[{id:"wage-from-corp",entityId:"corp",month:"2026-06",
    category:"wageNet",amount:-90000,internalTransferId:"2026-officer"},
   {id:"wage-to-person",entityId:"person",month:"2026-06",
    category:"wageNet",amount:90000,internalTransferId:"2026-officer"}]
 });
 assert.equal(wageProof.internalNetCash,0);
 const incomeTax=reconcileAnnualPayrollPrepayment({officerEntityId:"person",taxYear:2026,
  assessedWithProject:50000,assessedWithoutProject:30000,
  withheldWithProject:10000,withheldWithoutProject:0,
  projectRemittanceEvidence:{entityId:"person",taxYear:2026,
   withholdingRemitted:true,remittedAmount:10000,sourceId:"2026-officer"},
  baselineRemittanceEvidence:{entityId:"person",taxYear:2026,
   withholdingRemitted:true,remittedAmount:0,sourceId:"baseline-2026"}
 });
 assert.equal(incomeTax.incrementalFinalIncomeTaxCash,-10000);
 const mk=(kind,amount,id)=>({entityId:"person",taxYear:2026,taxKind:kind,
  amount,id,status:"estimated",ruleVersion:"2026-fixture",sourceUrl:kind==="saleGainTax"?ntaGain:ntaGen});
 const taxes=connectAnnualTaxAssessments({
  entities:[{entityId:"person",entityType:"individual"}],
  assessmentsWithProject:[mk("incomeTax",40000,"2026-inc"),mk("saleGainTax",capitalTax.totalTaxBeforeRounding,"2026-sale")],
  assessmentsWithoutProject:[mk("incomeTax",30000,"2026-inc"),mk("saleGainTax",0,"2026-sale")]
 });
 approximate(taxes.incrementalTaxCF,-341306.8);
 const eligible=reviewVATTaxpayerPeriod({entityId:"corp",taxPeriodStart:"2026-01-01",
  taxPeriodEnd:"2026-12-31",taxpayerType:"corporation",foreignTaxpayerClassification:"domestic",
  baselinePeriodTaxableSales:9000000,specificPeriodTaxableSales:8000000,
  specialPeriodAlternativePayrollAmount:8000000,specificPeriodTestBasis:"taxableSales",
  invoiceRegistration:"registeredWholePeriod",electedTaxableStatus:false,
  newCorporationCapital:null,newCorporation:false,
  capitalOrReorganizationException:false,largeAssetTaxationRestriction:false,
  method:"general",taxRule:{sourceUrl:ntavats,ruleVersion:"2026",applicabilityReviewed:true}});
 const settlement=reconcileVATAssessmentAndSettlement({vatTaxpayerPeriod:eligible,
  assessment:{assessmentId:"corp-vat-2026",entityId:"corp",taxPeriodEnd:"2026-12-31",
   status:"estimated",taxAmountAbs:250,settlementKind:"payment"},
  settlements:[{id:"paid-corp-vat",assessmentId:"corp-vat-2026",entityId:"corp",
   kind:"payment",cashDate:"2027-02-28",amount:250,confirmedPaidOrRefunded:true}]});
 assert.equal(settlement.status,"reconciled");
 const cashVat=compileVATInclusiveCash({
  lines:[{id:"corp-rent",entityId:"corp",month:"2026-09",kind:"sale",netAmount:1000,
   vatAmount:0,vatClass:"exempt",cashGrossAmount:1000}],
  taxSettlements:settlement.taxSettlements,
  taxCoverage:[{entityId:"corp",status:"estimated"}]});
 const byMonth=new Map();
 for(const event of salary.cashEvents.filter(x=>x.entityId==="corp")){
  byMonth.set(event.month,(byMonth.get(event.month)??0)+event.amount);
 }
 const corpBase={series:[...byMonth].map(([month,operating])=>({
  month,operating,investing:0,financing:0,pretaxEquityCF:operating
 }))};
 const corp=attachVATCashToEntityLedgers({baseLedgers:[{entityId:"corp",ledger:corpBase}],
  vatBridge:cashVat,provenance:"netPnlExcludedFromCash"});
 const personCash={series:[
  {month:"2026-06",operating:90000,investing:0,financing:0,pretaxEquityCF:90000},
  {month:"2026-12",operating:0,investing:1900000,financing:0,pretaxEquityCF:1900000}
 ]};
 const result=evaluatePortfolio({
  entityLedgers:[{entityId:"person",ledger:personCash},...corp],
  timeZero:[{entityId:"person",amount:-1100000}],baseCalendarYear:2026,
  holdingYears:1,discountRate:.08,taxes:taxes.entries,
  taxCoverage:[{entityId:"person",status:"estimated"},{entityId:"corp",status:"estimated"}]
 });
 assert.deepEqual(result.preTax.cashFlows,[-1100000,1891000,-250]);
 approximate(result.afterTax.cashFlows[2],-341556.8);
 approximate(result.reconciliation.afterTaxTotal,449443.2);
 assert.equal(result.annual.at(-1).year,2027);
 assert.equal(result.taxStatus,"estimated");
 // 10k withheld tax paid by company in 2026 + 10k final difference in 2027
 // is 20k total incremental personal income tax.
});
