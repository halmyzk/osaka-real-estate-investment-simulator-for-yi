import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {previewV11Scenario} from "../src/v11-preview-engine.mjs";
import {inspectV11Draft} from "../src/v11-draft-storage.mjs";
import {defaultV11IndicativeAssumptions} from "../src/v11-indicative-tax.mjs";
import {setV11QuickExpense,addV11QuickRenovation,editV11QuickLine,
 removeV11QuickLine,inspectV11QuickInputConflicts} from "../src/v11-quick-input.mjs";
import {buildV11InvestorWaterfall,v11InvestorWaterfallFields} from "../src/v11-investor-waterfall.mjs";
const read=name=>JSON.parse(readFileSync(new URL("../preview/"+name,import.meta.url),"utf8"));
const sample=read("v11-sample.json");
const owned=read("v11-owned-property-sample.json");
const mixed=read("v11-m3-mixed-use-sample.json");
const near=(x,y)=>assert.ok(Math.abs(x-y)<Math.max(1e-5,Math.abs(y)*1e-9),`${x} != ${y}`);
const forecast=(d,indicative=true)=>previewV11Scenario(d,
 indicative?{indicativeAssumptions:defaultV11IndicativeAssumptions(d)}:{});
const waterfall=(d,indicative=true)=>buildV11InvestorWaterfall({document:d,preview:forecast(d,indicative)});

test("Investor waterfall includes first-month acquisition and deposit ONLY in CF0, and first-year sale as annual disposal cash",()=>{
 const preview=forecast(sample,false),w=waterfall(sample,false);
 assert.equal(w.status,"preTaxOnly");
 near(w.initial.preTaxEquityCF,-1120000);
 near(w.total.preTaxEquityCF,preview.preTax.cashFlows.reduce((a,b)=>a+b,0));
 assert.equal(w.initial.acquisition,-1000000);
 assert.equal(w.initial.grossDisposal,0);
 assert.equal(w.annual[0].grossDisposal,1000000);
 assert.equal(w.annual[0].depositChange,100000);
 assert.equal(w.initial.depositChange,-100000);
 assert.equal(w.total.VATCash,0);
 assert.equal(w.total.incomeTaxCash,0);
 assert.equal(w.metrics.cashTaxPaidTotal,null);
 assert.equal(w.metrics.indicativeNetProfit,null);
 assert.equal(w.annual[0].preTaxEquityCF,preview.annual[0].preTaxEquityCF);
});
test("Investor waterfall separates post-exit 2027/2028 income tax and VAT from 2026 exit receipt",()=>{
 const p=forecast(mixed),w=waterfall(mixed);
 assert.equal(w.status,"estimated");
 assert.equal(w.annual.length,3);
 assert.deepEqual(w.annual.map(r=>r.year),[2026,2027,2028]);
 near(w.initial.preTaxEquityCF,p.CF0);
 near(w.annual[0].preTaxEquityCF,p.annual[0].preTaxEquityCF);
 assert.ok(w.annual[0].grossDisposal>0);
 assert.equal(w.annual[1].grossDisposal,0);
 assert.equal(w.annual[2].grossDisposal,0);
 assert.equal(w.annual[2].preTaxEquityCF,0);
 assert.ok(w.annual[1].incomeTaxCash<0);
 assert.ok(w.annual[2].incomeTaxCash<0);
 near(w.total.incomeTaxCash,p.indicativeCashReconciliation.incomeTaxCashTotal);
 near(w.total.VATCash,p.indicativeCashReconciliation.netVatCashTotal);
 near(w.total.indicativeEquityCF,p.indicativeAfterTax.cashFlows.reduce((x,y)=>x+y,0));
 near(w.metrics.indicativeNetProfit,w.total.indicativeEquityCF);
 assert.ok(w.notes.some(x=>x.includes("YEAR END")));
});
test("Mixed acquisition asset and future CapEx are independent from operations; editing one investment cannot move gross asset sale",()=>{
 const original=waterfall(owned);
 const initial=addV11QuickRenovation({
   document:owned,unitId:"osaka-m3",month:"2026-06",cost:120000
 });
 const extra=waterfall(initial.document);
 near(extra.initial.preTaxEquityCF,original.initial.preTaxEquityCF);
 near(extra.annual[0].renovationCapEx,-120000);
 near(extra.annual[0].operatingNet,original.annual[0].operatingNet);
 near(extra.total.grossDisposal,original.total.grossDisposal);
 near(extra.total.preTaxEquityCF,original.total.preTaxEquityCF-120000);
 const edited=editV11QuickLine({
   document:initial.document,unitId:"osaka-m3",lineId:initial.assetId,newAmount:150000
 });
 const changed=waterfall(edited.document);
 near(changed.annual[0].renovationCapEx,-150000);
 near(changed.annual[0].preTaxEquityCF,extra.annual[0].preTaxEquityCF-30000);
 assert.equal(edited.document.units[0].fields.K.K01.value,150000);
 const deleted=removeV11QuickLine({
   document:edited.document,unitId:"osaka-m3",lineId:initial.assetId
 });
 assert.equal(deleted.document.units[0].assets.length,owned.units[0].assets.length);
 assert.equal(deleted.document.units[0].fields.K.K01.value,0);
 near(waterfall(deleted.document).total.preTaxEquityCF,original.total.preTaxEquityCF);
 near(waterfall(deleted.document).total.grossDisposal,original.total.grossDisposal);
 assert.equal(inspectV11Draft(deleted.document).status,"structurallyReviewed");
});
test("Initial month renovation reduces CF0 but is never repeated in year-1 CapEx ledger",()=>{
 const original=waterfall(owned);
 const d=addV11QuickRenovation({
  document:owned,unitId:"osaka-m3",month:"2026-01",cost:75000
 }).document;
 const w=waterfall(d);
 near(w.initial.renovationCapEx,-75000);
 assert.equal(w.annual[0].renovationCapEx,0);
 near(w.initial.preTaxEquityCF,original.initial.preTaxEquityCF-75000);
 near(w.annual[0].preTaxEquityCF,original.annual[0].preTaxEquityCF);
});
test("Loan drawdown, origination fee, periodic interest and debt exit payoff are segregated and terminal loan balance is zero",()=>{
 const d=structuredClone(owned);
 d.units[0].loans=[{
  id:"case-loan",borrowerEntityId:"person-1",drawDate:"2026-01-01",
  principal:500000,annualInterestRate:6,termMonths:12,
  repaymentMethod:"bullet",fees:1000,prepayments:[]
 }];
 const model=forecast(d);
 const w=buildV11InvestorWaterfall({document:d,preview:model});
 const base=waterfall(owned);
 near(w.initial.loanDrawdown,500000);
 near(w.initial.financingFees,-1000);
 near(w.initial.preTaxEquityCF,base.initial.preTaxEquityCF+499000);
 near(w.annual[0].earlyAndExitPrincipal,-500000);
 near(w.annual[0].interest,-27500);
 assert.equal(w.annual[0].scheduledPrincipal,0);
 near(w.metrics.loanDrawdownTotal,500000);
 near(w.metrics.principalRepaidTotal,500000);
 near(w.metrics.cashInterestPaidTotal,27500);
 near(w.metrics.closingLoanBalanceByCash,0);
 near(w.total.indicativeEquityCF,model.indicativeAfterTax.cashFlows.reduce((a,b)=>a+b,0));
});
test("Edit/delete one monthly quick expense affects the recorded month once and never deletes manually entered records",()=>{
 const created=setV11QuickExpense({
  document:mixed,unitId:"osaka-m3",kind:"insurance",
  monthlyAmount:3500,fromMonth:"2026-04",toMonth:"2026-06"
 });
 const copy=structuredClone(created.document);
 const id="quick-insurance-2026-05";
 const edited=editV11QuickLine({
  document:created.document,unitId:"osaka-m3",lineId:id,newAmount:5500
 });
 const before=waterfall(created.document),after=waterfall(edited.document);
 near(after.annual[0].preTaxEquityCF,before.annual[0].preTaxEquityCF-2000);
 assert.deepEqual(created.document,copy,"edit must not mutate original");
 const removed=removeV11QuickLine({document:edited.document,unitId:"osaka-m3",lineId:id});
 near(waterfall(removed.document).annual[0].preTaxEquityCF,after.annual[0].preTaxEquityCF+5500);
 assert.equal(removed.document.units[0].expenses.length,mixed.units[0].expenses.length+2);
 assert.ok(removed.document.units[0].expenses.some(e=>e.id==="shared-utilities-2026-05"));
 assert.throws(()=>editV11QuickLine({
  document:mixed,unitId:"osaka-m3",lineId:"shared-utilities-2026-01",newAmount:1
 }),/Only uniquely marked/);
 assert.throws(()=>removeV11QuickLine({
  document:mixed,unitId:"osaka-m3",lineId:"building"
 }),/protected/);
 assert.throws(()=>editV11QuickLine({
  document:created.document,unitId:"osaka-m3",lineId:id,newAmount:-1
 }),/nonnegative/);
});
test("Duplicate warning detects monthly equal-value manual cost and A05, without mutating, guessing or deleting cash",()=>{
 const d=structuredClone(mixed);
 d.units[0].fields.A??={};
 d.units[0].fields.A.A05={value:500,unit:"JPY_per_month",sourceType:"userAssumption"};
 const u=setV11QuickExpense({
  document:d,unitId:"osaka-m3",kind:"utilities",monthlyAmount:20000,
  fromMonth:"2026-01",toMonth:"2026-01"
 }).document;
 const warning=inspectV11QuickInputConflicts({document:u,unitId:"osaka-m3"});
 assert.equal(warning.status,"review");
 assert.ok(warning.flags.some(x=>x.code==="sameAmountCategoryMonth"));
 assert.ok(warning.flags.some(x=>x.code==="propertyRecurringOverlap"&&x.fieldId==="A05"));
 assert.ok(u.units[0].expenses.some(e=>e.id==="shared-utilities-2026-01"));
 assert.ok(u.units[0].expenses.some(e=>e.id==="quick-utilities-2026-01"));
 const dedupe=removeV11QuickLine({document:u,unitId:"osaka-m3",lineId:"quick-utilities-2026-01"});
 const left=inspectV11QuickInputConflicts({document:dedupe.document,unitId:"osaka-m3"});
 assert.ok(left.flags.every(x=>x.code!=="sameAmountCategoryMonth"));
 assert.equal(dedupe.document.units[0].expenses.length,mixed.units[0].expenses.length);
});
test("OTA manual commissions and the H08 calculated fee are WARNED, not silently removed",()=>{
 const d=structuredClone(mixed);
 d.units[0].fields.H.H08={value:10,unit:"percent",sourceType:"userAssumption"};
 d.units[0].expenses.push({
  id:"manual-ota-2026-02",entityId:"person-1",
  category:"lodgingOperating",description:"OTA Booking.com販売手数料",
  amount:1000,currency:"JPY",periodStart:"2026-02-01",
  periodEnd:"2026-02-28",cashDate:"2026-02-28",
  allocationMethod:"direct",taxTreatment:"deductible"
 });
 const f=inspectV11QuickInputConflicts({document:d,unitId:"osaka-m3"});
 assert.ok(f.flags.some(x=>x.code==="otaCommissionOverlap"&&x.fieldId==="H08"));
 assert.equal(d.units[0].expenses.at(-1).amount,1000);
});
test("Conflicting manually copied IDs are a hard error; unknown delete/update IDs never modify owned source",()=>{
 const d=structuredClone(mixed);
 d.units[0].expenses.push({...d.units[0].expenses[0]});
 assert.throws(()=>inspectV11QuickInputConflicts({
  document:d,unitId:"osaka-m3"
 }),/Duplicate expense ID/);
 const original=structuredClone(owned);
 assert.throws(()=>removeV11QuickLine({
  document:owned,unitId:"osaka-m3",lineId:"not-found"
 }),/protected/);
 assert.throws(()=>editV11QuickLine({
  document:owned,unitId:"osaka-m3",lineId:"land",newAmount:100
 }),/protected/);
 assert.deepEqual(owned,original);
});
test("Investor waterfall refuses tampered nominal/after-tax CF instead of displaying an unbalanced financial report",()=>{
 const original=forecast(mixed);
 const changed=structuredClone(original);
 changed.annual[0].operating+=1;
 assert.throws(()=>buildV11InvestorWaterfall({document:mixed,preview:changed}),/reconcile/);
 const changedTax=structuredClone(original);
 changedTax.indicativeVATCashAdjustments[0].operating+=1;
 assert.throws(()=>buildV11InvestorWaterfall({document:mixed,preview:changedTax}),/VAT\/income tax waterfall/);
 assert.ok(v11InvestorWaterfallFields.includes("incomeTaxCash"));
});
test("Developer UI declares line edit/delete and conflict list with event delegation and financial waterfall",()=>{
 const html=readFileSync(new URL("../preview/v11-dev.html",import.meta.url),"utf8");
 for(const s of ["quick-conflict-list","data-quick-update","data-quick-remove",
  "data-quick-line-amount","investor-waterfall-kpi","investor-waterfall-table",
  "investor-waterfall-detail","renderInvestorWaterfall()",
  "inspectV11QuickInputConflicts","buildV11InvestorWaterfall",
  "editV11QuickLine","removeV11QuickLine"])
  assert.ok(html.includes(s),"Missing UI feature "+s);
 const code=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
 assert.ok(code);
 const syntax=spawnSync(process.execPath,["--input-type=module","--check"],{
  input:code,encoding:"utf8"
 });
 assert.equal(syntax.status,0,syntax.stderr);
});
