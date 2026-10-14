import test from "node:test";
import assert from "node:assert/strict";
import {reviewVATTaxpayerPeriod,reconcileVATAssessmentAndSettlement} from "../src/vat-taxpayer-settlement.mjs";
import {compileVATInclusiveCash,attachVATCashToEntityLedgers} from "../src/vat-cash.mjs";
import {evaluatePortfolio} from "../src/portfolio.mjs";
const nta="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6501.htm";
const standard={
 entityId:"corp",taxPeriodStart:"2026-01-01",taxPeriodEnd:"2026-12-31",
 taxpayerType:"corporation",foreignTaxpayerClassification:"domestic",baselinePeriodTaxableSales:9000000,
 specificPeriodTaxableSales:8000000,
 specialPeriodAlternativePayrollAmount:8000000,
 specificPeriodTestBasis:"taxableSales",invoiceRegistration:"none",
 electedTaxableStatus:false,newCorporationCapital:null,newCorporation:false,
 capitalOrReorganizationException:false,largeAssetTaxationRestriction:false,
 method:"general",taxRule:{sourceUrl:nta,ruleVersion:"2026-scenario",applicabilityReviewed:true}
};
test("B-T16 NTA 6501 <=10m base and specific period with all exceptions explicitly false => scenario exempt",()=>{
 const x=reviewVATTaxpayerPeriod(standard);
 assert.equal(x.status,"estimated");assert.equal(x.taxpayerStatus,"exempt");
});
test("B-T16 10m threshold exact and independently evidenced taxable triggers",()=>{
 assert.equal(reviewVATTaxpayerPeriod({...standard,baselinePeriodTaxableSales:10000000}).taxpayerStatus,"exempt");
 assert.equal(reviewVATTaxpayerPeriod({...standard,baselinePeriodTaxableSales:10000001}).taxpayerStatus,"taxable");
 assert.equal(reviewVATTaxpayerPeriod({...standard,invoiceRegistration:"registeredWholePeriod"}).taxpayerStatus,"taxable");
 assert.equal(reviewVATTaxpayerPeriod({...standard,electedTaxableStatus:true}).taxpayerStatus,"taxable");
 assert.equal(reviewVATTaxpayerPeriod({...standard,newCorporation:true,baselinePeriodTaxableSales:null,
  newCorporationCapital:10000000}).taxpayerStatus,"taxable");
 assert.equal(reviewVATTaxpayerPeriod({...standard,specificPeriodTaxableSales:10000001}).taxpayerStatus,"taxable");
});
test("No exemption inferred where invoice registration starts midperiod, payroll/specific test or high asset exception unknown",()=>{
 assert.equal(reviewVATTaxpayerPeriod({...standard,invoiceRegistration:"registeredPartPeriod"}).status,"incomplete");
 assert.equal(reviewVATTaxpayerPeriod({...standard,capitalOrReorganizationException:"unknown"}).status,"incomplete");
 assert.equal(reviewVATTaxpayerPeriod({...standard,specificPeriodTestBasis:"payrollAlternative",
  specialPeriodAlternativePayrollAmount:null}).status,"incomplete");
 assert.equal(reviewVATTaxpayerPeriod({...standard,largeAssetTaxationRestriction:"unknown"}).taxpayerStatus,null);
});
test("VAT exemption cannot have acquisition input-VAT refund assessment",()=>{
 const exempt=reviewVATTaxpayerPeriod(standard);
 assert.throws(()=>reconcileVATAssessmentAndSettlement({vatTaxpayerPeriod:exempt,
  assessment:{assessmentId:"a",entityId:"corp",taxPeriodEnd:"2026-12-31",
   status:"estimated",taxAmountAbs:100,settlementKind:"refund"},settlements:[]}));
});
const taxable=reviewVATTaxpayerPeriod({...standard,invoiceRegistration:"registeredWholePeriod"});
const assessment={assessmentId:"vat-2026",entityId:"corp",taxPeriodEnd:"2026-12-31",
 status:"estimated",taxAmountAbs:500,settlementKind:"payment"};
test("B-T17 positive assessed VAT cannot be booked until a dated cash payment matches in full",()=>{
 const pending=reconcileVATAssessmentAndSettlement({vatTaxpayerPeriod:taxable,assessment,
  settlements:[]});
 assert.equal(pending.status,"incomplete");
 assert.equal(pending.outstandingAmount,500);
 assert.deepEqual(pending.taxSettlements,[]);
 assert.equal(reconcileVATAssessmentAndSettlement({vatTaxpayerPeriod:taxable,assessment,
  settlements:[{id:"taxreceipt",assessmentId:"vat-2026",entityId:"corp",
   kind:"payment",cashDate:"2027-02-28",amount:500,confirmedPaidOrRefunded:true}]}).status,"reconciled");
});
test("B-T17 refund is not a positive cashflow until confirmation, mismatched and repeated remittances rejected",()=>{
 const refund={...assessment,settlementKind:"refund",taxAmountAbs:200};
 assert.equal(reconcileVATAssessmentAndSettlement({vatTaxpayerPeriod:taxable,assessment:refund,
  settlements:[{id:"refund",assessmentId:"vat-2026",entityId:"corp",
   kind:"refund",cashDate:"2027-03-10",amount:200,confirmedPaidOrRefunded:false}]}).status,"incomplete");
 assert.throws(()=>reconcileVATAssessmentAndSettlement({vatTaxpayerPeriod:taxable,assessment,
  settlements:[{id:"p",assessmentId:"vat-2026",entityId:"corp",
   kind:"refund",cashDate:"2027-02-28",amount:500,confirmedPaidOrRefunded:true}]}));
 assert.throws(()=>reconcileVATAssessmentAndSettlement({vatTaxpayerPeriod:taxable,assessment,
  settlements:[],alreadyBookedVATSettlement:true}));
});
test("B-T17 only confirmed VAT settlement crosses into VAT-inclusive cash and common-year portfolio",()=>{
 const reconciled=reconcileVATAssessmentAndSettlement({vatTaxpayerPeriod:taxable,assessment,
  settlements:[{id:"paid-2026",assessmentId:"vat-2026",entityId:"corp",kind:"payment",
   cashDate:"2027-02-28",amount:500,confirmedPaidOrRefunded:true}]});
 const bridge=compileVATInclusiveCash({
  lines:[{id:"stay",entityId:"corp",month:"2026-06",kind:"sale",netAmount:10000,
   vatAmount:1000,vatClass:"taxable",cashGrossAmount:11000}],
  taxSettlements:reconciled.taxSettlements,
  taxCoverage:[{entityId:"corp",status:"estimated"}]});
 assert.equal(bridge.lines.filter(x=>x.category==="consumptionTaxSettlement").length,1);
 const attached=attachVATCashToEntityLedgers({
  baseLedgers:[{entityId:"corp",ledger:{series:[]}}],vatBridge:bridge,
  provenance:"netPnlExcludedFromCash"});
 const p=evaluatePortfolio({entityLedgers:attached,baseCalendarYear:2026,holdingYears:1,
  discountRate:.08,taxCoverage:[{entityId:"corp",status:"estimated"}]});
 assert.deepEqual(p.preTax.cashFlows,[0,11000,-500]);
});

test("NTA 6501 foreign taxpayer cannot use payroll basis for post-2024 special period",()=>{
 const foreign=reviewVATTaxpayerPeriod({...standard,foreignTaxpayerClassification:"foreign",
  specificPeriodTestBasis:"payrollAlternative",
  specialPeriodAlternativePayrollAmount:8000000});
 assert.equal(foreign.status,"incomplete");
 assert.equal(foreign.taxpayerStatus,null);
 const domestic=reviewVATTaxpayerPeriod({...standard,
  specificPeriodTestBasis:"payrollAlternative",
  specialPeriodAlternativePayrollAmount:8000000});
 assert.equal(domestic.status,"estimated");
});
test("High-value asset VAT restriction may prohibit simplified taxation even with taxable taxpayer",()=>{
 const blocked=reviewVATTaxpayerPeriod({...standard,
  largeAssetTaxationRestriction:true,method:"simplified"});
 assert.equal(blocked.status,"incomplete");
 const missingNationality=reviewVATTaxpayerPeriod({...standard,foreignTaxpayerClassification:"unknown"});
 assert.equal(missingNationality.status,"incomplete");
});
