import test from "node:test";
import assert from "node:assert/strict";
import {calculateOperatingMonth} from "../src/operations.mjs";
import {compilePretaxLedger} from "../src/finance.mjs";
import {aggregateTaxableCategories,evaluatePortfolio} from "../src/portfolio.mjs";
import {allocateBusinessExpense,nationalPersonalIncomeTax,corporateNationalTax,
 planTaxPayments,incrementalTaxEvents} from "../src/tax.mjs";
import {configuredCorporateLocalTaxes,classifiedConsumptionVAT} from "../src/tax-detail.mjs";
import {depreciateAssetTimeline,verifyTaxRuleBundle} from "../src/tax-rules.mjs";
import {reconcileVATCash} from "../src/reconciliation.mjs";
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const src="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm";
test("M3 individual plus M4 corporation: independent revenue→tax base→payment month→after-tax portfolio NPV",()=>{
 const personal=calculateOperatingMonth({
  modelId:"M3",tenure:"own",calendarDays:28,lodgingDays:15,rentalDays:0,selfUseDays:10,changeoverDays:1,idleDays:2,
  lodging:{unavailableDays:0,occupancy:.5,adr:20000,ancillaryRevenue:0},rental:null,
  costs:{lodgingOperating:30000,rentalOperating:0,propertyOperating:20000,masterRent:0},
  maintenanceCapEx:0,deltaOperatingNWC:0});
 const corporate=calculateOperatingMonth({
  modelId:"M4",tenure:"own",calendarDays:28,lodgingDays:0,rentalDays:28,selfUseDays:0,changeoverDays:0,idleDays:0,
  lodging:null,rental:{mode:"forecast",monthlyRent:300000,occupancy:.8,otherRevenue:0},
  costs:{lodgingOperating:0,rentalOperating:20000,propertyOperating:10000,masterRent:0},
  maintenanceCapEx:0,deltaOperatingNWC:0});
 near(personal.lodging.revenue,150000);near(personal.operatingSurplus,100000);
 near(corporate.rental.revenue,240000);near(corporate.operatingSurplus,210000);
 const personalShared=allocateBusinessExpense({expense:240000,method:"private"});
 assert.equal(personalShared.amount,0); // own use not re-monetized as lodging
 const asset=depreciateAssetTimeline({
  id:"corporate-furniture",category:"furniture",openingBookValue:600000,acquisitionBasis:600000,
  method:"straightLine",annualRate:.1,
  years:[{taxYear:2026,inServiceMonths:12,businessUseRatio:1,ruleBasis:"scenarioAssumption",sourceUrl:src}]});
 assert.equal(asset.rows[0].deductibleDepreciation,60000);
 const aggregated=aggregateTaxableCategories([
  {entityId:"person",taxYear:2026,category:"miscellaneous",kind:"revenue",amount:personal.lodging.revenue},
  {entityId:"person",taxYear:2026,category:"miscellaneous",kind:"deductibleExpense",amount:50000},
  {entityId:"corp",taxYear:2026,category:"corporate",kind:"revenue",amount:corporate.rental.revenue},
  {entityId:"corp",taxYear:2026,category:"corporate",kind:"deductibleExpense",amount:30000},
  {entityId:"corp",taxYear:2026,category:"corporate",kind:"depreciation",amount:asset.rows[0].deductibleDepreciation}
 ]);
 const p=aggregated.find(x=>x.entityId==="person"), c=aggregated.find(x=>x.entityId==="corp");
 assert.equal(p.taxableCategoryProfit,100000);assert.equal(c.taxableCategoryProfit,150000);
 const rules=verifyTaxRuleBundle({
  taxpayerType:"individual",periodStart:"2026-12-31",requiredTaxKinds:["income"],
  rules:[{kind:"income",version:"2026-fixture",validFrom:"2026-01-01",validUntil:"2026-12-31",
    taxpayerType:"individual",basis:"scenarioAssumption",eligibilityConfirmed:false,sourceUrl:src}]});
 assert.equal(rules.status,"estimated");
 const personBaseline=nationalPersonalIncomeTax({taxYear:2026,taxableIncome:3000000});
 const personProject=nationalPersonalIncomeTax({taxYear:2026,taxableIncome:3000000+p.taxableCategoryProfit});
 const deltaPersonal=personProject.totalNationalTax-personBaseline.totalNationalTax;
 near(deltaPersonal,10210);
 const corpTax=corporateNationalTax({taxYear:2026,taxableIncome:c.taxableCategoryProfit,
   eligibleSmallCompany:true,defenseCorporateApplies:false});
 assert.equal(corpTax.corporateNationalTax,22500);
 const corpLocal=configuredCorporateLocalTaxes({
   taxYear:2026,taxBase:c.taxableCategoryProfit,corporateNationalBaseTax:corpTax.corporateNationalTax,
   legalEntityCount:1,ruleSourceUrl:"https://example.org/illustrative-local-tax-only",
   components:[{kind:"corporateBusinessIncomeLevy",basis:"taxableIncome",rate:.04}]});
 assert.equal(corpLocal.total,6000);
 const a=planTaxPayments({entityId:"person",entityType:"individual",taxYear:2026,
   assessments:[{id:"incremental-income",taxKind:"incomeTax",amount:deltaPersonal}]});
 const b=planTaxPayments({entityId:"corp",entityType:"corporation",taxYear:2026,
   assessments:[{id:"national",taxKind:"corporateTax",amount:corpTax.corporateNationalTax},
    {id:"local",taxKind:"otherTax",amount:corpLocal.total,paymentMonths:["2027-02"]}]});
 const tax=incrementalTaxEvents({withProject:[...a.entries,...b.entries],withoutProject:[]});
 near(tax.incrementalTaxCF,-38710);
 const pp=compilePretaxLedger({operatingMonths:[{unitId:"osaka-m3",month:"2026-02",result:personal}]});
 const cc=compilePretaxLedger({operatingMonths:[{unitId:"tokyo-m4",month:"2026-02",result:corporate}]});
 const portfolio=evaluatePortfolio({
  entityLedgers:[{entityId:"person",ledger:pp},{entityId:"corp",ledger:cc}],
  timeZero:[{entityId:"person",amount:-60000},{entityId:"corp",amount:-40000}],
  taxes:tax.entries,
  taxCoverage:[{entityId:"person",status:"estimated"},{entityId:"corp",status:"estimated"}],
  baseCalendarYear:2026,holdingYears:1,discountRate:.08});
 assert.deepEqual(portfolio.preTax.cashFlows,[-100000,310000,0]);
 near(portfolio.annual[1].taxCashFlow,-38710);
 near(portfolio.afterTax.cashFlows[1],310000);
 near(portfolio.afterTax.cashFlows[2],-38710);
 near(portfolio.afterTax.NPV,-100000+310000/1.08-38710/(1.08**2));
 near(portfolio.reconciliation.afterTaxTotal,171290);
 assert.equal(portfolio.annual.length,2); // year-after-holding taxes preserved
 assert.equal(portfolio.taxStatus,"estimated");
});

test("VAT gross cash reconciliation is a separate gate, never automatic 10% capex recovery",()=>{
 const transactions=[
  {id:"hotel",kind:"sale",netAmount:150000,vatAmount:15000,vatClass:"taxable"},
  {id:"residential",kind:"sale",netAmount:240000,vatAmount:0,vatClass:"exempt"},
  {id:"lodging-supplies",kind:"expense",netAmount:10000,vatAmount:1000,vatClass:"taxable",
   inputAttribution:"taxableRelated"}
 ];
 const vat=classifiedConsumptionVAT({status:"taxable",method:"general",transactions});
 assert.equal(vat.grossCashReceipts,405000);
 assert.equal(vat.grossCashPayments,11000);
 assert.equal(vat.netVATPayment,14000);
 const recon=reconcileVATCash({
  grossReceipts:vat.grossCashReceipts,grossPayments:vat.grossCashPayments,
  outputVAT:vat.outputVAT,inputVAT:vat.inputVAT,creditsAllowed:vat.inputVATCredit,
  expectedNetVATPayment:vat.netVATPayment,expectedNetVATRefund:0,
  settlementPayment:14000,settlementRefund:0,actualCashNet:380000});
 assert.equal(recon.status,"verified");
 // This is not merged with the separate P/L engine until VAT-inclusive
 // transaction classification is fully wired for each taxpayer and unit.
});
