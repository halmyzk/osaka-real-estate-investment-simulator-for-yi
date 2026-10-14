import test from "node:test";
import assert from "node:assert/strict";
import {calculateOperatingMonth} from "../src/operations.mjs";
import {buildReconciledEntityCash} from "../src/cash-adapter.mjs";
import {evaluatePortfolio} from "../src/portfolio.mjs";
const operation=calculateOperatingMonth({
 modelId:"M2",tenure:"lease",calendarDays:30,lodgingDays:15,rentalDays:10,selfUseDays:0,changeoverDays:1,idleDays:4,
 lodging:{unavailableDays:0,occupancy:.6,adr:30000,ancillaryRevenue:0},
 rental:{mode:"forecast",monthlyRent:300000,occupancy:.8,otherRevenue:0},
 costs:{lodgingOperating:20000,rentalOperating:5000,propertyOperating:5000,masterRent:150000},
 maintenanceCapEx:10000,deltaOperatingNWC:2000
});
const make=(id,category,net,vat=0,vatClass="exempt")=>({
 id,kind:category.endsWith("Revenue")?"sale":category==="maintenanceCapEx"?"capital":"expense",
 category,net,vat,gross:net+vat,vatClass
});
const invoices=[
 make("lodging","lodgingRevenue",270000,27000,"taxable"),make("rental","rentalRevenue",80000),
 make("hotel","lodgingOperating",20000,2000,"taxable"),make("rent","rentalOperating",5000),
 make("property","propertyOperating",5000),make("master","masterRent",150000),
 make("capex","maintenanceCapEx",10000,1000,"taxable")
];
const unitMonths=[{unitId:"osaka-1",month:"2026-04",result:operation,invoices}];
test("Gate A VAT operating-to-cash is replacement, not net plus gross",()=>{
 const r=buildReconciledEntityCash({entityId:"person",unitMonths,vatCoverageStatus:"estimated",
  vatSettlements:[{id:"vat",entityId:"person",month:"2027-03",kind:"payment",amount:24000}]});
 assert.equal(r.status,"reconciled");
 assert.equal(r.sourceInvoiceCount,7);
 const a=r.ledger.series.find(x=>x.month==="2026-04");
 assert.equal(a.operating,377000-(20000+2000+5000+5000+150000)-2000);
 assert.equal(a.investing,-11000);
 assert.equal(a.pretaxEquityCF,182000);
 const b=r.ledger.series.find(x=>x.month==="2027-03");
 assert.equal(b.pretaxEquityCF,-24000);
 const p=evaluatePortfolio({entityLedgers:[r],baseCalendarYear:2026,holdingYears:1,discountRate:.08,
  taxCoverage:[{entityId:"person",status:"estimated"}]});
 assert.deepEqual(p.preTax.cashFlows,[0,182000,-24000]);
});
test("Gate A misses an invoice, source mismatch or repeated unit-month, refuses evaluation",()=>{
 assert.throws(()=>buildReconciledEntityCash({entityId:"person",unitMonths:[{...unitMonths[0],invoices:invoices.slice(1)}],vatCoverageStatus:"estimated"}));
 assert.throws(()=>buildReconciledEntityCash({entityId:"person",unitMonths:[unitMonths[0],unitMonths[0]],vatCoverageStatus:"estimated"}));
 assert.throws(()=>buildReconciledEntityCash({entityId:"person",unitMonths,vatCoverageStatus:"incomplete"}));
});
test("Gate A duplicate investment/maintenance cash rejected",()=>{
 assert.throws(()=>buildReconciledEntityCash({entityId:"person",unitMonths,vatCoverageStatus:"estimated",
 investing:[{kind:"investing",month:"2026-04",category:"maintenanceCapEx",amount:-10000,reference:"extra"}]}));
});
test("Gate A cash ledger can include independent acquisition and finance, without duplicating sales",()=>{
 const r=buildReconciledEntityCash({entityId:"person",unitMonths,vatCoverageStatus:"computed",
 investing:[{kind:"investing",month:"2026-03",category:"acquisitionPrice",amount:-1000000,reference:"unit"}],
 financing:[{kind:"financing",month:"2026-03",category:"loanDrawdown",amount:700000,reference:"loan"}]});
 assert.equal(r.ledger.series[0].pretaxEquityCF,-300000);
 assert.equal(r.ledger.series[1].pretaxEquityCF,182000);
});
