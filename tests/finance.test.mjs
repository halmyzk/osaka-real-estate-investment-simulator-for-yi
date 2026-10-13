import test from "node:test";
import assert from "node:assert/strict";
import {calculateOperatingMonth} from "../src/operations.mjs";
import {debtAmortization,ledgerFromLoan,investingEvents,compilePretaxLedger} from "../src/finance.mjs";
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const op=(extra={})=>calculateOperatingMonth({
  modelId:"M1",tenure:"own",calendarDays:30,lodgingDays:20,rentalDays:0,selfUseDays:0,changeoverDays:0,idleDays:10,
  lodging:{unavailableDays:0,occupancy:.5,adr:20000,ancillaryRevenue:0},
  costs:{lodgingOperating:70000,rentalOperating:0,propertyOperating:15000,masterRent:0},
  maintenanceCapEx:5000,deltaOperatingNWC:1000,...extra
});
test("100m acquisition, 70m borrowing = -30m at funding month",()=>{
  const inv=investingEvents({acquisitions:[{id:"property",month:"2026-01",price:100_000_000,closingCosts:0}]});
  const loan=ledgerFromLoan({loanId:"debt",drawMonth:"2026-01",principal:70_000_000,annualInterestRate:0,termMonths:120});
  const ledger=compilePretaxLedger({investing:inv,financing:loan.events});
  assert.equal(ledger.series.find(x=>x.month==="2026-01").pretaxEquityCF,-30_000_000);
});
test("zero percent annuity amortizes in 12 months",()=>{
  const loan=debtAmortization({loanId:"l1",drawMonth:"2026-01",principal:1_200_000,annualInterestRate:0,termMonths:12});
  assert.equal(loan.paymentRecords.length,12);
  near(loan.totalInterest,0);
  near(loan.contractualFinalBalance,0);
  near(loan.paymentRecords[0].scheduledPrincipal,100000);
  assert.equal(loan.paymentRecords[0].month,"2026-02");
});
test("4.5% annuity payments satisfy principal and never accrue after maturity",()=>{
  const loan=debtAmortization({loanId:"a",drawMonth:"2026-01",principal:12_000_000,annualInterestRate:.045,termMonths:240});
  near(loan.paymentRecords.reduce((s,x)=>s+x.scheduledPrincipal+x.prepayment,0),12_000_000);
  near(loan.contractualFinalBalance,0);
  assert.ok(loan.totalInterest>0);
  for(const row of loan.paymentRecords)near(row.openingBalance-row.scheduledPrincipal-row.prepayment,row.closingBalance);
});
test("equal principal has declining interest and constant scheduled principal",()=>{
  const x=debtAmortization({loanId:"l",drawMonth:"2026-01",principal:120000,annualInterestRate:.12,termMonths:12,repaymentMethod:"equalPrincipal"});
  near(x.paymentRecords[0].interest,1200);
  near(x.paymentRecords[0].scheduledPrincipal,10000);
  near(x.paymentRecords[1].interest,1100);
  near(x.contractualFinalBalance,0);
});
test("prepayment reduces balance; overpayment is rejected",()=>{
  const x=debtAmortization({loanId:"p",drawMonth:"2026-01",principal:120000,annualInterestRate:0,termMonths:12,
    prepayments:[{monthIndex:2,amount:50000,fee:300}]});
  assert.equal(x.paymentRecords[1].prepayment,50000);
  assert.equal(x.paymentRecords[1].prepaymentFee,300);
  near(x.contractualFinalBalance,0);
  assert.throws(()=>debtAmortization({loanId:"p",drawMonth:"2026-01",principal:120000,annualInterestRate:0,termMonths:12,
    prepayments:[{monthIndex:1,amount:1000000}]}),RangeError);
});
test("sale at month-end settles outstanding balance only once",()=>{
  const l=ledgerFromLoan({loanId:"exit",drawMonth:"2026-01",principal:120000,annualInterestRate:0,termMonths:12}, "2026-07");
  const settle=l.events.filter(x=>x.category==="exitDebtPayoff");
  assert.equal(settle.length,1);
  near(settle[0].amount,-60000);
  assert.equal(l.events.filter(x=>x.category==="scheduledPrincipal").length,6);
  near(l.events.reduce((a,x)=>a+x.amount,0),0);
});
test("CapEx, deposit return, sale proceeds, restricted cash are cash once",()=>{
  const inv=investingEvents({
    capitalSpending:[{id:"fit",month:"2026-01",purpose:"initial",amount:20_000_000}],
    refundableDeposits:[{id:"dep",month:"2026-01",action:"paid",amount:1_000_000},{id:"ret",month:"2030-01",action:"refunded",amount:1_000_000}],
    restrictedCashChanges:[{id:"lock",month:"2026-01",delta:500000},{id:"unlock",month:"2030-01",delta:-500000}],
    disposals:[{id:"sale",month:"2030-01",proceeds:22_000_000,sellingCosts:1_000_000,exitObligations:100000}]
  });
  const cf=compilePretaxLedger({investing:inv});
  assert.equal(cf.series.find(x=>x.month==="2026-01").pretaxEquityCF,-21_500_000);
  assert.equal(cf.series.find(x=>x.month==="2030-01").pretaxEquityCF,22_400_000);
});
test("operating bridge: 109k CFADS equals OCF + ICF absent finance",()=>{
  const r=op();
  const l=compilePretaxLedger({operatingMonths:[{unitId:"unit-1",month:"2026-02",result:r}]});
  assert.equal(r.preTaxCFADS,109000);
  assert.equal(l.series[0].operating,114000);
  assert.equal(l.series[0].investing,-5000);
  assert.equal(l.series[0].pretaxEquityCF,109000);
});
test("month alignment joins acquisition, debt and operating in shared calendar",()=>{
  const investment=investingEvents({acquisitions:[{id:"a",month:"2026-01",price:1000000}]});
  const loan=ledgerFromLoan({loanId:"l",drawMonth:"2026-01",principal:700000,annualInterestRate:0,termMonths:10});
  const ledger=compilePretaxLedger({operatingMonths:[{unitId:"u1",month:"2026-02",result:op()}],investing:investment,financing:loan.events});
  assert.equal(ledger.series[0].month,"2026-01");
  assert.equal(ledger.series[0].pretaxEquityCF,-300000);
  assert.equal(ledger.series[1].month,"2026-02");
  assert.equal(ledger.series[1].pretaxEquityCF,39000);
});
test("bad type, duplicate transactions, and duplicate unit month are rejected",()=>{
  assert.throws(()=>investingEvents({capitalSpending:[{id:"dup",month:"2026-01",amount:1,purpose:"initial"},{id:"dup",month:"2026-02",amount:1,purpose:"initial"}]}),RangeError);
  assert.throws(()=>compilePretaxLedger({operatingMonths:[{unitId:"u",month:"2026-02",result:op()},{unitId:"u",month:"2026-02",result:op()}]}),RangeError);
  assert.throws(()=>debtAmortization({loanId:"x",drawMonth:"2026-01",principal:null,annualInterestRate:.05,termMonths:12}),RangeError);
  assert.throws(()=>investingEvents({restrictedCashChanges:[{id:"bad",month:"2026-01",delta:NaN}]}),RangeError);
});
test("an unrestricted planning-only reserve is not an investment cash outflow",()=>{
  const ledger=compilePretaxLedger({});
  assert.equal(ledger.totals.pretaxEquityCF,0);
  assert.equal(ledger.series.length,0);
});
