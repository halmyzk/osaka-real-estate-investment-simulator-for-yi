import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectV11Draft} from "../src/v11-draft-storage.mjs";
import {previewV11Scenario} from "../src/v11-preview-engine.mjs";
import {
 setV11QuickExpense,setV11QuickOTA,addV11QuickRenovation,
 v11QuickExpenseKinds
} from "../src/v11-quick-input.mjs";
import {defaultV11IndicativeAssumptions} from "../src/v11-indicative-tax.mjs";
import {applyV11FinancialShock} from "../src/v11-financial-sensitivity.mjs";
const source=JSON.parse(readFileSync(new URL("../preview/v11-m3-mixed-use-sample.json",import.meta.url),"utf8"));
const owner=JSON.parse(readFileSync(new URL("../preview/v11-owned-property-sample.json",import.meta.url),"utf8"));
const tol=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} !== ${b}`);
const preview=d=>previewV11Scenario(d,{indicativeAssumptions:defaultV11IndicativeAssumptions(d)});
const cash=d=>previewV11Scenario(d).preTax.cashFlows;
test("Quick utility monthly rates create native expense records with no duplicate on repeating identical range",()=>{
 const copy=structuredClone(source);
 const prior=copy.units[0].expenses.length;
 const initial=cash(copy);
 const r=setV11QuickExpense({
  document:copy,unitId:"osaka-m3",kind:"utilities",
  monthlyAmount:1500,fromMonth:"2026-03",toMonth:"2026-05"
 });
 assert.equal(copy.units[0].expenses.length,prior,"pure transformation");
 assert.equal(r.document.units[0].expenses.length,prior+3);
 const update=setV11QuickExpense({
  document:r.document,unitId:"osaka-m3",kind:"utilities",
  monthlyAmount:2500,fromMonth:"2026-03",toMonth:"2026-05"
 });
 assert.equal(update.document.units[0].expenses.length,prior+3);
 assert.equal(update.document.units[0].expenses.filter(x=>x.id==="quick-utilities-2026-03").length,1);
 tol(cash(update.document)[1]-initial[1],-7500);
 assert.equal(inspectV11Draft(update.document).status,"structurallyReviewed");
 const spent=preview(update.document);
 assert.equal(spent.indicativeTaxStatus,"estimated");
 assert.ok(spent.indicativeExpenseProof.some(x=>x.kind==="utilities"));
});
test("Fixed asset tax/insurance use building service share for M3, with NO supplier VAT, unlike shared utilities",()=>{
 const make=(kind)=>setV11QuickExpense({
  document:source,unitId:"osaka-m3",kind,
  monthlyAmount:36500,fromMonth:"2026-04",toMonth:"2026-04"
 }).document;
 const tax=preview(make("propertyTax"));
 const ins=preview(make("insurance"));
 const util=preview(make("utilities"));
 const expense=(r,kind)=>r.indicativeExpenseProof.find(x=>x.kind===kind);
 const t=expense(tax,"propertyTax"),n=expense(ins,"insurance"),u=expense(util,"utilities");
 tol(t.netDeductible,36500*.6);
 tol(n.netDeductible,36500*.6);
 tol(u.netDeductible,36500*.6*54/365);
 assert.equal(t.vatPaid,0);
 assert.equal(n.vatPaid,0);
 tol(u.vatPaid,3650);
 tol(tax.indicativeVATRows[0].taxableVendorVATPaid,24000);
 tol(util.indicativeVATRows[0].taxableVendorVATPaid,27650);
 assert.equal(ins.afterTax,null);
});
test("OTA entered once as existing H08 percent and never as extra explicit expense",()=>{
 const start=previewV11Scenario(source);
 const applied=setV11QuickOTA({document:source,unitId:"osaka-m3",percentage:15});
 const changed=previewV11Scenario(applied.document);
 assert.equal(source.units[0].fields.H.H08,undefined);
 assert.equal(applied.document.units[0].fields.H.H08.value,15);
 assert.equal(applied.document.units[0].expenses.length,source.units[0].expenses.length);
 tol(changed.annual[0].preTaxEquityCF-start.annual[0].preTaxEquityCF,-162000);
 assert.equal(inspectV11Draft(applied.document).status,"structurallyReviewed");
});
test("Renovation enters investing cash ONE time, not operating or land/building acquisition",()=>{
 const initial=previewV11Scenario(owner);
 const r=addV11QuickRenovation({
  document:owner,unitId:"osaka-m3",month:"2026-06",cost:100000
 });
 assert.equal(owner.units[0].assets.length,2);
 const updated=previewV11Scenario(r.document);
 assert.equal(updated.CF0,initial.CF0);
 tol(updated.preTax.cashFlows[1]-initial.preTax.cashFlows[1],-100000);
 assert.equal(updated.annual[0].operating,initial.annual[0].operating);
 assert.equal(updated.units[0].investing.filter(x=>x.category==="initialCapEx").length,1);
 const investment=updated.units[0].investing.find(x=>x.category==="initialCapEx");
 assert.equal(investment.amount,-100000);
 assert.equal(investment.month,"2026-06");
 assert.equal(r.document.units[0].fields.K.K01.value,100000);
 assert.equal(inspectV11Draft(r.document).status,"structurallyReviewed");
 const estimated=preview(r.document);
 assert.equal(estimated.indicativeTaxStatus,"estimated");
 assert.equal(estimated.afterTax,null);
});
test("First-month renovation belongs in CF0, never again in annual CF",()=>{
 const initial=previewV11Scenario(owner);
 const d=addV11QuickRenovation({
  document:owner,unitId:"osaka-m3",month:"2026-01",cost:100000
 }).document;
 const now=previewV11Scenario(d);
 assert.equal(now.CF0,initial.CF0-100000);
 assert.deepEqual(now.preTax.cashFlows.slice(1),initial.preTax.cashFlows.slice(1));
});
test("Cost input guardrails: classification, period, private fee, negative and manual ID collision",()=>{
 for(const [kind,amount,from,to,pattern] of [
  ["unrecognized",100,"2026-01","2026-01",/Unknown/],
  ["utilities",-1,"2026-01","2026-01",/nonnegative/],
  ["utilities",100,"2025-12","2026-01",/opening/],
  ["utilities",100,"2026-04","2026-03",/range/]
 ]){
  assert.throws(()=>setV11QuickExpense({
   document:source,unitId:"osaka-m3",kind,monthlyAmount:amount,fromMonth:from,toMonth:to
  }),pattern);
 }
 assert.throws(()=>setV11QuickExpense({
  document:owner,unitId:"tokyo-m4",kind:"propertyTax",monthlyAmount:100,
  fromMonth:"2026-01",toMonth:"2026-01"
 }),/only for owned/);
 assert.throws(()=>setV11QuickOTA({document:owner,unitId:"tokyo-m4",percentage:15}),/lodging/);
 const collision=structuredClone(source);
 collision.units[0].expenses[0].id="quick-utilities-2026-01";
 assert.throws(()=>setV11QuickExpense({
   document:collision,unitId:"osaka-m3",kind:"utilities",monthlyAmount:10,
   fromMonth:"2026-01",toMonth:"2026-01"
 }),/ID conflict/);
 assert.throws(()=>addV11QuickRenovation({
  document:source,unitId:"osaka-m3",month:"2027-01",cost:100
 }),/outside/);
});
test("ADR and occupancy scenario shocks move only one chosen unit and do not mutate base storage",()=>{
 for(const kind of ["adr","occupancy"]){
   const original=structuredClone(source);
   const s=applyV11FinancialShock({document:source,
    scenarioId:"base",unitId:"osaka-m3",kind,shockFraction:.1});
   assert.deepEqual(source,original);
   assert.equal(s.document.scenarios.find(x=>x.id==="base").overrides.length,1);
   const a=preview(s.document);
   const b=preview(source);
   assert.ok(a.indicativeAfterTax.NPV>b.indicativeAfterTax.NPV);
   assert.equal(a.CF0,b.CF0);
 }
 const cap=applyV11FinancialShock({
  document:source,scenarioId:"base",unitId:"osaka-m3",kind:"occupancy",shockFraction:2
 });
 assert.throws(()=>preview(cap.document),/occupancy exceeds|outside permitted/);
});
test("Purchase-price sensitivity holds gross sale proceeds fixed; reprices asset basis and initial equity once",()=>{
 const s=applyV11FinancialShock({document:owner,scenarioId:"base",
  unitId:"osaka-m3",kind:"purchase",shockFraction:.1});
 const original=previewV11Scenario(owner),changed=previewV11Scenario(s.document);
 assert.equal(s.originalValue,1000000);
 assert.equal(s.stressedValue,1100000);
 assert.equal(s.document.units[0].fields.A.A01.value,1000000);
 assert.equal(s.document.units[0].assets[0].grossCost,440000);
 assert.equal(s.document.units[0].assets[1].grossCost,660000);
 assert.equal(changed.CF0,original.CF0-100000);
 const saleTotal=x=>x.units[0].investing.filter(e=>e.category==="disposalProceeds").reduce((s,e)=>s+e.amount,0);
 tol(saleTotal(changed),saleTotal(original));
 assert.equal(inspectV11Draft(s.document).status,"structurallyReviewed");
 assert.ok(preview(s.document).indicativeAfterTax.NPV<preview(owner).indicativeAfterTax.NPV);
});
test("Sale-price shock holds acquisition/initial CF0 fixed; 10% positive sale raises NPV",()=>{
 const shock=applyV11FinancialShock({document:owner,scenarioId:"base",
  unitId:"osaka-m3",kind:"sale",shockFraction:.1});
 const before=preview(owner),after=preview(shock.document);
 assert.equal(shock.originalValue,1200000);
 tol(shock.stressedValue,1320000);
 assert.equal(before.CF0,after.CF0);
 tol(after.preTax.cashFlows[1]-before.preTax.cashFlows[1],120000);
 assert.ok(after.indicativeAfterTax.NPV>before.indicativeAfterTax.NPV);
 assert.equal(owner.units[0].exit.priceGrowthRate,20,"original not mutated");
});
test("Financial shock guardrails preserve leased M4 and impossible parameters",()=>{
 assert.throws(()=>applyV11FinancialShock({document:owner,scenarioId:"base",
  unitId:"tokyo-m4",kind:"purchase",shockFraction:.1}),/owned/);
 assert.throws(()=>applyV11FinancialShock({document:owner,scenarioId:"base",
  unitId:"osaka-m3",kind:"sale",shockFraction:-1}),/outside/);
 assert.throws(()=>applyV11FinancialShock({document:owner,scenarioId:"base",
  unitId:"osaka-m3",kind:"excess",shockFraction:.1}),/Invalid/);
});
test("Developer UI binds expense, OTA, CapEx and financial sensitivity controls to functional helpers",()=>{
 const html=readFileSync(new URL("../preview/v11-dev.html",import.meta.url),"utf8");
 for(const control of ["quick-cost-kind","quick-cost-amount","quick-cost-from",
  "quick-cost-to","apply-quick-cost","quick-ota","apply-quick-ota",
  "quick-capex-month","quick-capex-amount","apply-quick-capex",
  "quick-shock-pct","quick-sensitivity-table"]){
  assert.match(html,new RegExp('id="'+control+'"'));
 }
 for(const method of ["setV11QuickExpense","setV11QuickOTA","addV11QuickRenovation","applyV11FinancialShock"])
  assert.match(html,new RegExp(method+"\\("));
 assert.ok(Object.keys(v11QuickExpenseKinds).length>=5);
});
