import test from "node:test";
import assert from "node:assert/strict";
import {corporateLossCarryforward,individualSaleGainTax,
 configuredCorporateLocalTaxes,classifiedConsumptionVAT} from "../src/tax-detail.mjs";
const NTA_LOSS="https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/5762.htm";
const NTA_SALE="https://www.nta.go.jp/publication/pamph/koho/kurashi/pdf/16.pdf";
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
test("loss carryforward consumes oldest vintage, excludes expired vintage",()=>{
 const r=corporateLossCarryforward({taxYear:2026,profitBeforeCarryforward:3000000,eligible:true,
  maxOffsetFraction:1,allowNewLossCarryforward:true,ruleSourceUrl:NTA_LOSS,
  openingLosses:[{id:"new",originYear:2022,expirationYear:2032,remainingAmount:2000000},
   {id:"old",originYear:2018,expirationYear:2025,remainingAmount:400000},
   {id:"oldest",originYear:2020,expirationYear:2030,remainingAmount:1500000}]});
 assert.equal(r.usedLoss,3000000);
 assert.equal(r.taxableIncome,0);
 assert.equal(r.expiredLoss,400000);
 assert.deepEqual(r.closingLosses.map(x=>[x.id,x.remainingAmount]),[["new",500000]]);
});
test("50%-capped loss deduction and negative year not automatic refund",()=>{
 const r=corporateLossCarryforward({taxYear:2026,profitBeforeCarryforward:3000000,eligible:true,
  maxOffsetFraction:.5,allowNewLossCarryforward:true,ruleSourceUrl:NTA_LOSS,
  openingLosses:[{id:"old",originYear:2024,expirationYear:2034,remainingAmount:2000000}]});
 assert.equal(r.usedLoss,1500000);
 assert.equal(r.taxableIncome,1500000);
 const neg=corporateLossCarryforward({taxYear:2026,profitBeforeCarryforward:-200000,eligible:false,
  maxOffsetFraction:0,allowNewLossCarryforward:false,ruleSourceUrl:NTA_LOSS,openingLosses:[]});
 assert.equal(neg.taxableIncome,0);
 assert.equal(neg.newLossAdded,0);
});
test("personal long and short sale tax separate, no automatic relief",()=>{
 const long=individualSaleGainTax({taxYear:2026,taxableGain:1000000,holdingClass:"long",
  reconstructionRate:.021,defenseIncomeRate:0,ruleSourceUrl:NTA_SALE});
 assert.equal(long.nationalBaseTax,150000);
 assert.equal(long.localResidenceTax,50000);
 near(long.reconstructionTax,3150);
 near(long.totalTaxBeforeRounding,203150);
 const sh=individualSaleGainTax({taxYear:2026,taxableGain:1000000,holdingClass:"short",
  reconstructionRate:.021,defenseIncomeRate:0,ruleSourceUrl:NTA_SALE});
 near(sh.totalTaxBeforeRounding,396300);
 assert.throws(()=>individualSaleGainTax({taxYear:2026,taxableGain:1000000,holdingClass:"long",
  reconstructionRate:.021,defenseIncomeRate:0,specialDeduction:3000000,ruleSourceUrl:NTA_SALE}));
});
test("corporate local taxes are explicitly configured and cannot silently vanish",()=>{
 const r=configuredCorporateLocalTaxes({taxYear:2026,taxBase:10000000,corporateNationalBaseTax:1664000,
  legalEntityCount:1,ruleSourceUrl:"https://www.example.org/illustrative-municipal-rate",
  components:[{kind:"corporateResidenceIncomeLevy",basis:"nationalCorporateTax",rate:.06},
   {kind:"corporateResidencePerCapita",basis:"fixedAmount",fixedAmount:50000},
   {kind:"corporateBusinessIncomeLevy",basis:"taxableIncome",rate:.04}]});
 near(r.breakdown[0].amount,99840);near(r.total,549840);
 assert.throws(()=>configuredCorporateLocalTaxes({taxYear:2026,taxBase:10000000,
  corporateNationalBaseTax:1664000,legalEntityCount:1,ruleSourceUrl:"https://example.org",components:[]}));
});
test("lodging taxable, residential rent exempt; VAT cash gross and credit allocation",()=>{
 const tx=[
  {id:"lodging",kind:"sale",netAmount:1000000,vatAmount:100000,vatClass:"taxable"},
  {id:"rental",kind:"sale",netAmount:600000,vatAmount:0,vatClass:"exempt"},
  {id:"furniture",kind:"capital",netAmount:300000,vatAmount:30000,vatClass:"taxable",inputAttribution:"taxableRelated"},
  {id:"mixed",kind:"expense",netAmount:100000,vatAmount:10000,vatClass:"taxable",inputAttribution:"common"}];
 const r=classifiedConsumptionVAT({status:"taxable",method:"general",transactions:tx,taxableSalesRatio:.5});
 assert.equal(r.grossCashReceipts,1700000);
 assert.equal(r.grossCashPayments,440000);
 assert.equal(r.outputVAT,100000);
 assert.equal(r.inputVATCredit,35000);
 assert.equal(r.netVATPayment,65000);
 const exempt=classifiedConsumptionVAT({status:"exempt",method:"general",transactions:tx,taxableSalesRatio:.5});
 assert.equal(exempt.inputVATCredit,0);
 assert.equal(exempt.refund,0);
});
test("refund cannot be booked without separate eligibility; no flat 10% capex refund",()=>{
 const tx=[{id:"equipment",kind:"capital",netAmount:2000000,vatAmount:200000,
  vatClass:"taxable",inputAttribution:"taxableRelated"}];
 const r=classifiedConsumptionVAT({status:"taxable",method:"general",transactions:tx});
 assert.equal(r.status,"incomplete");assert.equal(r.refund,null);
 const c=classifiedConsumptionVAT({status:"taxable",method:"general",transactions:tx,confirmedRefundEligibility:true});
 assert.equal(c.refund,200000);
 assert.throws(()=>classifiedConsumptionVAT({status:"taxable",method:"general",transactions:[
  {id:"rent",kind:"sale",netAmount:100000,vatAmount:10000,vatClass:"exempt"}]}));
});
