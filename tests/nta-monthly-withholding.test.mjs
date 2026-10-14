import test from "node:test";
import assert from "node:assert/strict";
import {lookupNtaMonthlyWithholding,officialNtaTableSources} from "../src/nta-monthly-withholding.mjs";
import {compileOfficerPayrollMonth} from "../src/officer-payroll-withholding.mjs";
const read=(taxYear,base,dependentCount=0,tableColumn="ko",payPeriod="monthly")=>
  lookupNtaMonthlyWithholding({taxYear,taxableMonthlyBase:base,dependentCount,tableColumn,payPeriod});
test("NTA 2026 monthly 甲0: official 105,000 zero boundary and tax amount brackets p1",()=>{
 assert.equal(read(2026,104999).withholdingAmount,0);
 assert.equal(read(2026,105000).withholdingAmount,170);
 assert.equal(read(2026,106999).withholdingAmount,170);
 assert.equal(read(2026,107000).withholdingAmount,280);
 assert.equal(read(2026,114999).withholdingAmount,580);
 assert.equal(read(2026,115000).withholdingAmount,680);
 assert.equal(read(2026,300000).withholdingAmount,7930);
 assert.equal(read(2026,300000,1).withholdingAmount,6320);
 assert.equal(read(2026,300000,4).withholdingAmount,1470);
 assert.equal(read(2026,137000,1).withholdingAmount,190);
 assert.equal(read(2026,136999).status,"incomplete");
 assert.equal(read(2026,300000).sourceUrl,officialNtaTableSources[2026]);
});
test("NTA 2027 monthly 甲0: official new 111,000 zero boundary and changed tax bands p1/p2",()=>{
 assert.equal(read(2027,110999).withholdingAmount,0);
 assert.equal(read(2027,111000).withholdingAmount,140);
 assert.equal(read(2027,112999).withholdingAmount,140);
 assert.equal(read(2027,113000).withholdingAmount,250);
 assert.equal(read(2027,120999).withholdingAmount,550);
 assert.equal(read(2027,123000).withholdingAmount,760);
 assert.equal(read(2027,300000).withholdingAmount,7760);
 assert.equal(read(2027,300000,1).withholdingAmount,6150);
 assert.equal(read(2027,300000,4).withholdingAmount,1300);
 assert.equal(read(2027,143000,1).withholdingAmount,160);
 assert.equal(read(2027,142999).status,"incomplete");
});
test("NTA 2026 vs 2027 salary 110k/month is 380 yen vs zero; cannot reuse prior-year brackets",()=>{
 assert.equal(read(2026,110000).withholdingAmount,380);
 assert.equal(read(2027,110000).withholdingAmount,0);
 assert.notEqual(read(2026,300000).withholdingAmount,read(2027,300000).withholdingAmount);
});
test("Unsupported table column, pay period, salary band or year blocks calculation rather than zero",()=>{
 for(const x of [
  read(2026,200000),read(2027,250000),read(2026,110000,0,"otsu"),
  read(2026,110000,0,"ko","bonus"),read(2027,110000,0,"ko","daily"),
  read(2028,110000),read(2026,110000,8)
 ])assert.equal(x.status,"incomplete");
 assert.throws(()=>read(2026,NaN));
 assert.throws(()=>read(2026,-1));
 assert.throws(()=>read(2026,112000.5));
});
const money=(taxYear,withholdingAmount,base=110000)=>({
 payrollId:"payroll-"+taxYear,employerEntityId:"corp",officerEntityId:"officer",
 month:taxYear+"-02",cashSalaryGross:base+5000,noncashHousingBenefit:0,
 employeeSocialInsurance:5000,withholdingTax:withholdingAmount,
 withholdingRemittanceMonth:taxYear+"-03",socialRemittanceMonth:taxYear+"-03",
 employerExpenseDeductibility:"reviewedDeductible",
 taxTableEvidence:{taxYear,payPeriod:"monthly",tableColumn:"ko",dependentCount:0,
  version:"NTA-MONTHLY-"+taxYear+"-VERIFIED-SUBSET",
  sourceUrl:officialNtaTableSources[taxYear],lookupStatus:"officialTableVerified",
  declarationSubmitted:true,dependentCountReviewed:true,
  taxableMonthlyBase:base,withholdingAmount}
});
test("Officer payroll can use official amount instead of arbitrary scenario-provided NTA tax",()=>{
 const a=compileOfficerPayrollMonth(money(2026,380));
 const b=compileOfficerPayrollMonth(money(2027,0));
 assert.equal(a.status,"estimated");assert.equal(b.status,"estimated");
 assert.equal(a.tableVerificationStatus,"officialRowVerified");
 assert.equal(b.tableVerificationStatus,"officialRowVerified");
 assert.equal(a.cashEvents.length,4);
 assert.equal(a.employeeCashReceipt,109620);
 assert.equal(b.employeeCashReceipt,110000);
});
test("Official status cannot be forged with an arbitrary amount, year or URL",()=>{
 assert.throws(()=>compileOfficerPayrollMonth(money(2026,20000)),/NTA official tax table amount/);
 assert.throws(()=>compileOfficerPayrollMonth({...money(2027,0),
  taxTableEvidence:{...money(2027,0).taxTableEvidence,
   sourceUrl:officialNtaTableSources[2026]}}));
 assert.throws(()=>compileOfficerPayrollMonth({...money(2026,380),
  taxTableEvidence:{...money(2026,380).taxTableEvidence,
   version:"arbitrary-fixture"}}));
 const unsupported=compileOfficerPayrollMonth(money(2026,7000,200000));
 assert.equal(unsupported.status,"incomplete");
 assert.deepEqual(unsupported.cashEvents,[]);
 assert.equal(unsupported.tableVerificationStatus,"incomplete");
});

test("Official ko row is not sufficient without reviewed submitted declaration and dependents",()=>{
 const example=money(2026,380);
 const missingDeclaration=compileOfficerPayrollMonth({...example,
  taxTableEvidence:{...example.taxTableEvidence,declarationSubmitted:false}});
 assert.equal(missingDeclaration.status,"incomplete");
 assert.deepEqual(missingDeclaration.cashEvents,[]);
 const unknownCount=compileOfficerPayrollMonth({...example,
  taxTableEvidence:{...example.taxTableEvidence,dependentCountReviewed:false}});
 assert.equal(unknownCount.status,"incomplete");
 assert.equal(unknownCount.officialEligibilityReviewed,false);
});
