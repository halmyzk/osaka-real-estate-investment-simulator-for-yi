import test from "node:test";
import assert from "node:assert/strict";
import {planTaxPayments,incrementalTaxEvents,applyTaxToPretaxLedger} from "../src/tax.mjs";
import {compilePretaxLedger,investingEvents} from "../src/finance.mjs";
test("income tax is assessed in 2026 and projected cash paid March 2027",()=>{
 const p=planTaxPayments({entityId:"person1",entityType:"individual",taxYear:2026,
   assessments:[{id:"income",taxKind:"incomeTax",amount:250000}]});
 assert.equal(p.status,"estimated");
 assert.equal(p.entries.length,1);
 assert.equal(p.entries[0].month,"2027-03");
 assert.equal(p.entries[0].amount,250000);
});
test("individual residence tax paid next-year installments including January in year+2",()=>{
 const p=planTaxPayments({entityId:"person1",entityType:"individual",taxYear:2026,
   assessments:[{id:"res",taxKind:"residenceTax",amount:400000}]});
 assert.deepEqual(p.entries.map(x=>x.month),["2027-06","2027-08","2027-10","2028-01"]);
 assert.deepEqual(p.entries.map(x=>x.amount),[100000,100000,100000,100000]);
});
test("corporate fiscal year end September and 2-month delay",()=>{
 const p=planTaxPayments({entityId:"corp",entityType:"corporation",taxYear:2027,fiscalYearEndMonth:9,
   assessments:[{id:"income",taxKind:"corporateTax",amount:1664000},
     {id:"vat",taxKind:"consumptionTax",amount:100000}]});
 assert.deepEqual(p.entries.map(x=>x.month),["2027-11","2027-11"]);
 assert.equal(p.entries.reduce((x,e)=>x+e.amount,0),1764000);
});
test("negative unconfirmed refund blocked; confirmed refund flows positive CF",()=>{
 assert.throws(()=>planTaxPayments({entityId:"a",entityType:"individual",taxYear:2026,
   assessments:[{id:"vat",taxKind:"consumptionTax",amount:-100000}]}));
 const p=planTaxPayments({entityId:"a",entityType:"individual",taxYear:2026,
   assessments:[{id:"vat",taxKind:"consumptionTax",amount:-100000,refundConfirmed:true}]});
 const diff=incrementalTaxEvents({withProject:p.entries,withoutProject:[]});
 assert.equal(diff.incrementalTaxCF,100000);
});
test("sale year 2035 tax paid in 2036 must extend CF beyond 10-year holding period",()=>{
 const pretax=compilePretaxLedger({investing:investingEvents({disposals:[
   {id:"sale",month:"2035-12",proceeds:11000000,sellingCosts:500000}
 ]})});
 const p=planTaxPayments({entityId:"person",entityType:"individual",taxYear:2035,
   assessments:[{id:"saleTax",taxKind:"saleGainTax",amount:200000}]});
 const tax=incrementalTaxEvents({withProject:p.entries,withoutProject:[]});
 const joined=applyTaxToPretaxLedger(pretax,tax);
 assert.equal(joined.series[0].month,"2035-12");
 assert.equal(joined.series[1].month,"2036-03");
 assert.equal(joined.series[1].afterTaxEquityCF,-200000);
 assert.equal(joined.totals.afterTaxEquityCF,10300000);
});
test("unconfigured local corporate tax payment schedule cannot silently be zero",()=>{
 assert.throws(()=>planTaxPayments({entityId:"corp",entityType:"corporation",taxYear:2026,
  assessments:[{id:"local",taxKind:"otherTax",amount:25000}]}));
});
test("explicit schedule and percentages override forecast due dates",()=>{
 const p=planTaxPayments({entityId:"corp",entityType:"corporation",taxYear:2026,
   assessments:[{id:"corp",taxKind:"corporateTax",amount:100000,
     paymentMonths:["2026-06","2027-02"],paymentWeights:[.4,.6]}]});
 assert.deepEqual(p.entries.map(x=>x.amount),[40000,60000]);
 assert.throws(()=>planTaxPayments({entityId:"corp",entityType:"corporation",taxYear:2026,
   assessments:[{id:"bad",taxKind:"corporateTax",amount:1000,paymentMonths:["2026-06","2027-02"],paymentWeights:[.3,.3]}]}));
});
