import test from "node:test";
import assert from "node:assert/strict";
import {calculateEntityDSCR,groupScheduledDebtService} from "../src/dscr.mjs";
const base={entityId:"corp",month:"2027-03",operatingSurplus:200000,maintenanceCapEx:30000,
 deltaOperatingNWC:10000,incrementalCashIncomeTaxPaid:20000,scheduledPrincipal:50000,
 interestPaid:20000,prepaymentPrincipal:100000,prepaymentFee:2000};
test("Gate A after-tax entity CFADS/DSCR, prepayment not in denominator",()=>{
 const r=calculateEntityDSCR(base);
 assert.equal(r.preTaxCFADS,160000);
 assert.equal(r.afterTaxCFADS,140000);
 assert.equal(r.debtService,70000);
 assert.equal(r.DSCR,2);
 assert.equal(r.postScheduledDebtCF,70000);
 assert.equal(r.postDebtCashAfterPrepayment,-32000);
});
test("Gate A zero debt service => DSCR N/A, not zero/infinity",()=>{
 const r=calculateEntityDSCR({...base,scheduledPrincipal:0,interestPaid:0});
 assert.equal(r.DSCR,null);assert.equal(r.dscrStatus,"notApplicable");
});
test("Gate A negative CFADS remains negative and shortfall explicit",()=>{
 const r=calculateEntityDSCR({...base,operatingSurplus:0});
 assert.equal(r.afterTaxCFADS,-60000);
 assert.equal(r.DSCR,-60000/70000);
 assert.equal(r.dscrStatus,"negative");
});
test("Gate A zero tax matches pre- and after-tax CFADS",()=>{
 const r=calculateEntityDSCR({...base,incrementalCashIncomeTaxPaid:0});
 assert.equal(r.preTaxCFADS,r.afterTaxCFADS);
});
test("Gate A confirmed refund can increase after-tax CFADS but invalid missing data rejected",()=>{
 const r=calculateEntityDSCR({...base,incrementalCashIncomeTaxPaid:-5000});
 assert.equal(r.afterTaxCFADS,165000);
 assert.throws(()=>calculateEntityDSCR({...base,incrementalCashIncomeTaxPaid:null}));
});
test("Gate A scheduled debt records aggregate entity loans, not other taxpayer loans",()=>{
 const p={loanId:"a",entityId:"corp",month:"2027-03",scheduledPrincipal:30000,interest:15000,
  prepayment:30000,prepaymentFee:1000,scheduledDebtService:45000};
 const q={...p,loanId:"b",scheduledPrincipal:20000,interest:5000,prepayment:0,
  prepaymentFee:0,scheduledDebtService:25000};
 assert.deepEqual(groupScheduledDebtService({entityId:"corp",month:"2027-03",loanPayments:[p,q]}),
  {scheduledPrincipal:50000,interestPaid:20000,prepaymentPrincipal:30000,prepaymentFee:1000});
 assert.throws(()=>groupScheduledDebtService({entityId:"person",month:"2027-03",loanPayments:[p]}));
 assert.throws(()=>groupScheduledDebtService({entityId:"corp",month:"2027-03",loanPayments:[p,p]}));
});
