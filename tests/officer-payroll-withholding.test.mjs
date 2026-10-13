import test from "node:test";
import assert from "node:assert/strict";
import {compileOfficerPayrollMonth,payrollCorporateTaxItems,reconcileAnnualPayrollPrepayment} from "../src/officer-payroll-withholding.mjs";
import {connectAnnualTaxAssessments} from "../src/income-tax-bridge.mjs";
import {evaluatePortfolio} from "../src/portfolio.mjs";
const src="https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/01.htm";
const arg={payrollId:"corp-officer-2027-01",employerEntityId:"corp",officerEntityId:"person",
 month:"2027-01",cashSalaryGross:100000,noncashHousingBenefit:15000,
 employeeSocialInsurance:10000,withholdingTax:20000,
 withholdingRemittanceMonth:"2027-02",socialRemittanceMonth:"2027-02",
 employerExpenseDeductibility:"reviewedDeductible",
 taxTableEvidence:{taxYear:2027,payPeriod:"monthly",tableColumn:"ko",version:"fixture-2027",
 sourceUrl:src,lookupStatus:"scenarioAssumption",taxableMonthlyBase:105000,
 withholdingAmount:20000}};
test("B-T13/14 payroll: noncash officer housing changes withholding base, not salary cash",()=>{
 const p=compileOfficerPayrollMonth(arg);
 assert.equal(p.taxableGrossSalary,115000);
 assert.equal(p.taxableMonthlyBase,105000);
 assert.equal(p.employeeCashReceipt,70000);
 assert.equal(p.incomeTaxPrepayment,20000);
 assert.equal(p.cashEvents.length,4);
 const byEntity=p.cashEvents.reduce((s,e)=>(s[e.entityId]=(s[e.entityId]??0)+e.amount,s),{});
 assert.equal(byEntity.person,70000);
 assert.equal(byEntity.corp,-100000);
 assert.equal(byEntity.corp+byEntity.person,-30000); // external income tax + social remittance
});
test("2027 tax table may not be silently reused for 2026 payroll",()=>{
 assert.throws(()=>compileOfficerPayrollMonth({...arg,month:"2026-01"}));
 assert.throws(()=>compileOfficerPayrollMonth({...arg,taxTableEvidence:{...arg.taxTableEvidence,
  taxableMonthlyBase:90000}}));
 assert.throws(()=>compileOfficerPayrollMonth({...arg,
  taxTableEvidence:{...arg.taxTableEvidence,lookupStatus:"unknown"}}));
});
test("Corporate officer payroll tax items expense gross cash once, withholding and housing not duplicated",()=>{
 const p=compileOfficerPayrollMonth(arg);
 const x=payrollCorporateTaxItems({payrollMonths:[p],taxYear:2027,employerEntityId:"corp"});
 assert.equal(x.bookedExpense.amount,100000);
 assert.equal(x.nondeductibleAddback.amount,0);
 assert.throws(()=>payrollCorporateTaxItems({payrollMonths:[p,p],taxYear:2027,employerEntityId:"corp"}));
 const restricted=payrollCorporateTaxItems({
  payrollMonths:[compileOfficerPayrollMonth({...arg,employerExpenseDeductibility:"reviewedNotDeductible"})],
  taxYear:2027,employerEntityId:"corp"});
 assert.equal(restricted.nondeductibleAddback.amount,100000);
});
test("Employee final personal income tax payable deducts only actual remitted prepayment",()=>{
 const inputs={officerEntityId:"person",taxYear:2027,assessedWithProject:80000,
  assessedWithoutProject:50000,withheldWithProject:20000,withheldWithoutProject:5000,
  projectRemittanceEvidence:{entityId:"person",taxYear:2027,
   withholdingRemitted:true,remittedAmount:20000,sourceId:"corp-payroll-2027"},
  baselineRemittanceEvidence:{entityId:"person",taxYear:2027,
   withholdingRemitted:true,remittedAmount:5000,sourceId:"baseline-employer"}};
 const r=reconcileAnnualPayrollPrepayment(inputs);
 assert.equal(r.cashPayableWithProject,60000);
 assert.equal(r.cashPayableWithoutProject,45000);
 assert.equal(r.incrementalFinalIncomeTaxCash,-15000);
 assert.equal(r.reconciliation,0);
 const extra=connectAnnualTaxAssessments({entities:[{entityId:"person",entityType:"individual"}],
  assessmentsWithProject:[{id:"individual",entityId:"person",taxYear:2027,taxKind:"incomeTax",amount:60000,
   status:"estimated",ruleVersion:"fixture-2027",sourceUrl:src}],
  assessmentsWithoutProject:[{id:"individual",entityId:"person",taxYear:2027,taxKind:"incomeTax",amount:45000,
   status:"estimated",ruleVersion:"fixture-2027",sourceUrl:src}]});
 assert.equal(extra.incrementalTaxCF,-15000);
 const employee=p=>({month:p.month,operating:p.amount,investing:0,financing:0,pretaxEquityCF:p.amount});
 const payroll=compileOfficerPayrollMonth(arg);
 const ledgerEntries=payroll.cashEvents.map(p=>({...p,kind:"operating"}));
 const payrollLedger=[{entityId:"corp",ledger:{series:ledgerEntries.filter(x=>x.entityId==="corp")
  .map(employee)}},{entityId:"person",ledger:{series:ledgerEntries.filter(x=>x.entityId==="person")
   .map(employee)}}];
 // EvaluatePortfolio requires monthly entries unique; aggregate corporate 2027-02 remittances.
 const normalized=payrollLedger.map(x=>{
  const mm=new Map();
  for(const m of x.ledger.series)mm.set(m.month,(mm.get(m.month)??0)+m.operating);
  return {entityId:x.entityId,ledger:{series:[...mm].map(([month,operating])=>
   ({month,operating,investing:0,financing:0,pretaxEquityCF:operating}))}};
 });
 const p=evaluatePortfolio({entityLedgers:normalized,baseCalendarYear:2027,
  holdingYears:1,discountRate:.08,taxes:extra.entries,
  taxCoverage:[{entityId:"corp",status:"estimated"},{entityId:"person",status:"estimated"}]});
 assert.deepEqual(p.preTax.cashFlows,[0,-30000,0]);
 assert.deepEqual(p.afterTax.cashFlows,[0,-30000,-15000]);
 // -30k external payroll withholding/social + -15k final top-up;
 // the 15k extra payroll withheld vs baseline is a different external flow.
});
test("Unverified personal annual refund stays incomplete and never creates cash inflow",()=>{
 const base={officerEntityId:"person",taxYear:2027,assessedWithProject:5000,
  assessedWithoutProject:0,withheldWithProject:20000,withheldWithoutProject:0,
  projectRemittanceEvidence:{entityId:"person",taxYear:2027,
   withholdingRemitted:true,remittedAmount:20000,sourceId:"2027-table"},
  baselineRemittanceEvidence:{entityId:"person",taxYear:2027,
   withholdingRemitted:true,remittedAmount:0,sourceId:"baseline-zero"}};
 const r=reconcileAnnualPayrollPrepayment(base);
 assert.equal(r.status,"incomplete");
 assert.equal(r.cashPayableWithProject,null);
 assert.equal(r.potentialProjectRefund,15000);
 assert.throws(()=>reconcileAnnualPayrollPrepayment({...base,
  projectRemittanceEvidence:{...base.projectRemittanceEvidence,withholdingRemitted:false}}));
});
