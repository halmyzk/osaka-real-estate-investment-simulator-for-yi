import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {previewV11Scenario} from "../src/v11-preview-engine.mjs";
import {
 defaultV11IndicativeAssumptions,estimateV11IndicativeTaxCash,
 appendV11IndicativeVATToLedgers
} from "../src/v11-indicative-tax.mjs";
const data=name=>JSON.parse(readFileSync(new URL("../preview/"+name,import.meta.url),"utf8"));
const doc=data("v11-m3-mixed-use-sample.json");
const owned=data("v11-owned-property-sample.json");
const nearly=(x,y)=>assert.ok(Math.abs(x-y)<1e-6,`${x} != ${y}`);
const init=d=>defaultV11IndicativeAssumptions(d);
const calc=(d=doc,assumptions=init(d),scenarioId="base")=>
 previewV11Scenario(d,{scenarioId,indicativeAssumptions:assumptions});

test("No assumptions means no guessed after-tax value: explicit scenario unlocks labeled indicative KPIs but preserves formal afterTax:null",()=>{
 const noPlan=previewV11Scenario(doc);
 assert.equal(noPlan.indicativeAfterTax,null);
 assert.equal(noPlan.indicativeTaxStatus,"notRequested");
 assert.equal(noPlan.afterTax,null);
 const withPlan=calc();
 assert.equal(withPlan.status,"estimated-pre-tax");
 assert.equal(withPlan.indicativeTaxStatus,"estimated");
 assert.equal(withPlan.taxStatus,"incomplete");
 assert.equal(withPlan.afterTax,null);
 assert.equal(withPlan.CF0,-1100000);
 assert.equal(withPlan.indicativeAfterTax.npvStatus,"computed");
 // In a one-year sale with income/capital tax due in later years, the
 // investor's cash flows can change signs multiple times. Do NOT force one IRR.
 assert.equal(withPlan.indicativeAfterTax.irrStatus,"ambiguous");
 assert.equal(withPlan.indicativeAfterTax.IRR,null);
 assert.ok(Number.isFinite(withPlan.indicativeAfterTax.NPV));
 assert.equal(withPlan.annualIndicativeCashFlows.length,3);
 assert.equal(withPlan.annualIndicativeCashFlows.at(-1).year,2028);
 assert.ok(withPlan.indicativeWarnings.length>=5);
});

test("Independent M3 personal/private and corporate tenant example: no VAT refunds, tax basis split and post-exit cash",()=>{
 const r=calc();
 const vat=r.indicativeVATRows;
 assert.equal(vat.length,2);
 const person=vat.find(x=>x.entityId==="person-1");
 const corp=vat.find(x=>x.entityId==="corporation-1");
 assert.equal(person.registered,false);
 assert.equal(person.outputVAT,0);
 nearly(person.taxableVendorVATPaid,24000);
 assert.equal(person.estimatedCashSettlement,0);
 assert.equal(corp.outputVAT,0);
 nearly(corp.taxableVendorVATPaid,1200);
 nearly(r.indicativeCashReconciliation.netVatCashTotal,-25200);
 const p=r.indicativeTaxRows.find(x=>x.entityId==="person-1");
 const c=r.indicativeTaxRows.find(x=>x.entityId==="corporation-1");
 nearly(p.categoryProfit.miscellaneous,
   1080000-240000*.6*54/365-24000*.6*54/365-18000);
 nearly(p.estimatedOrdinaryTax,p.categoryProfit.miscellaneous*.3);
 nearly(c.categoryProfit.corporate,1080000-12000-600000-1200);
 nearly(c.estimatedOrdinaryTax,466800*.3);
 assert.equal(r.indicativeSaleRows[0].positiveTaxableGain,220000);
 assert.equal(r.indicativeSaleRows[0].estimatedGainRate,.4);
 nearly(r.indicativeCashReconciliation.incomeTaxCashTotal,
  -(p.estimatedOrdinaryTax+c.estimatedOrdinaryTax+88000));
 assert.ok(r.indicativeIncomeTaxCashEvents.some(e=>e.month==="2028-01"&&e.taxKind==="indicativeSaleResidenceTax"));
 const t=r.annualIndicativeCashFlows;
 nearly(t[0].netOperatingBase,1308000);
 nearly(t[0].VATCashDifference,-25200);
 nearly(t[0].indicativeAfterTaxEquityCF,2598000-25200);
 nearly(t[0].netOperatingBase+t[0].VATCashDifference,
    t[0].VATAdjustedOperatingCash);
 nearly(r.indicativeAfterTax.cashFlows.reduce((s,x)=>s+x,0),
   -1100000+2598000-25200+r.indicativeCashReconciliation.incomeTaxCashTotal);
});

test("Registered M3 lodging collects output VAT, only recovers business-related supplier VAT, settles next March once",()=>{
 const assumption=init(doc);
 assumption.vatRegisteredByEntity["person-1"]=true;
 const result=calc(doc,assumption),p=result.indicativeVATRows.find(x=>x.entityId==="person-1");
 nearly(p.outputVAT,108000);
 nearly(p.taxableVendorVATPaid,24000);
 nearly(p.creditClaimCandidate,24000*.6*54/365);
 nearly(p.creditApplied,p.creditClaimCandidate);
 nearly(p.estimatedCashSettlement,108000-24000*.6*54/365);
 assert.equal(p.settlementMonth,"2027-03");
 const month=result.indicativeVATCashAdjustments.find(x=>x.entityId==="person-1"&&x.month==="2027-03");
 nearly(month.vatSettlement,-p.estimatedCashSettlement);
 nearly(sum(result.indicativeVATCashAdjustments
   .filter(x=>x.entityId==="person-1").map(x=>x.operating)),108000-24000-p.estimatedCashSettlement);
 const person=result.indicativeTaxRows.find(x=>x.entityId==="person-1");
 nearly(person.categoryProfit.miscellaneous,1080000-240000*.6*54/365-18000);
 assert.equal(result.afterTax,null);
});
function sum(xs){return xs.reduce((a,b)=>a+b,0);}
test("Zero VAT and zero indicative tax rates reproduce pre-tax equity cash even across the later tax years",()=>{
 const a=init(doc);
 a.personalOrdinaryEffectiveRate=0;a.corporateEffectiveRate=0;
 a.personalShortSaleGainRate=0;a.personalLongSaleGainRate=0;a.vatRate=0;
 const r=calc(doc,a);
 assert.equal(r.indicativeCashReconciliation.netVatCashTotal,0);
 assert.equal(r.indicativeCashReconciliation.incomeTaxCashTotal,0);
 assert.deepEqual(r.indicativeAfterTax.cashFlows,r.preTax.cashFlows);
 nearly(r.indicativeAfterTax.NPV,r.preTax.NPV);
 nearly(r.indicativeAfterTax.IRR,r.preTax.IRR);
});

test("Scenario changes reuse rate assumptions (unlike stale reviewed-tax evidence), changing indicative after-tax value without changing base",()=>{
 const a=init(doc);
 const base=calc(doc,a,"base"),up=calc(doc,a,"upside");
 assert.equal(base.indicativeTaxStatus,"estimated");
 assert.equal(up.indicativeTaxStatus,"estimated");
 assert.notEqual(up.indicativeAfterTax.NPV,base.indicativeAfterTax.NPV);
 assert.notEqual(up.indicativeTaxRows.find(x=>x.entityId==="person-1").estimatedOrdinaryTax,
   base.indicativeTaxRows.find(x=>x.entityId==="person-1").estimatedOrdinaryTax);
 assert.equal(calc(doc,{...a,personalOrdinaryEffectiveRate:.2}).indicativeTaxStatus,"estimated");
 const changed=structuredClone(doc);
 changed.units[0].fields.H.H01.value=30000;
 const result=calc(changed,a);
 assert.equal(result.indicativeTaxStatus,"estimated");
 assert.ok(result.indicativeAfterTax.NPV!==base.indicativeAfterTax.NPV);
});
test("Cannot combine indicative mode with statutory reviewed sidecar or compute from partial/invalid assumptions",()=>{
 const a=init(doc);
 assert.throws(()=>previewV11Scenario(doc,{indicativeAssumptions:a,incomeTaxSidecar:{version:"fake"}}),/exactly one/);
 assert.throws(()=>previewV11Scenario(doc,{indicativeAssumptions:a,derivedTaxPlan:{version:"fake"}}),/exactly one/);
 for(const patch of [
  x=>{delete x.vatRegisteredByEntity["person-1"]},
  x=>{x.vatRate=-.1},
  x=>{x.personalOrdinaryEffectiveRate=2},
  x=>{x.inputAmountsBasis="amountsAreAlreadyGross"},
  x=>{x.noAutomaticTaxRefunds=false},
  x=>{x.assumedBuildingShareOfPurchase=NaN},
  x=>{x.vatSettlementMonth=13}
 ]){
   const b=structuredClone(a);patch(b);
   assert.throws(()=>calc(doc,b));
 }
 const missing=structuredClone(doc);missing.units[0].calendar.pop();
 const notReady=calc(missing,a);
 assert.equal(notReady.status,"incomplete");
 assert.equal(notReady.preTax,null);
});
test("No VAT refund when registered exempt-rent M4 pays vendor VAT but has zero output; residence rent cannot be treated as taxable",()=>{
 const a=init(owned);
 a.vatRegisteredByEntity["corporation-1"]=true;
 const r=calc(owned,a);
 assert.equal(r.indicativeTaxStatus,"estimated");
 const corp=r.indicativeVATRows.find(x=>x.entityId==="corporation-1");
 assert.equal(corp.outputVAT,0);
 assert.equal(corp.creditApplied,0);
 assert.equal(corp.estimatedCashSettlement,0);
 nearly(corp.taxableVendorVATPaid,1200);
 assert.equal(r.indicativeSaleRows[0].positiveTaxableGain,220000);
 assert.equal(r.indicativeTaxRows.find(x=>x.entityId==="person-1").categoryProfit.realEstate>0,true);
});
test("Both entity ledgers produce balanced VAT-adjusted cash once and reject duplicate gross VAT cash",()=>{
 const ledgers=[{entityId:"a",ledger:{series:[
  {month:"2026-01",operating:100,investing:-20,financing:0,pretaxEquityCF:80}
 ]}}];
 const diff=[{entityId:"a",month:"2026-01",operating:10},
             {entityId:"a",month:"2027-03",operating:-8}];
 const once=appendV11IndicativeVATToLedgers({entityLedgers:ledgers,vatCashAdjustments:diff});
 assert.equal(once[0].ledger.series[0].operating,110);
 assert.equal(once[0].ledger.series[0].pretaxEquityCF,90);
 assert.equal(once[0].ledger.series[1].pretaxEquityCF,-8);
 assert.equal(ledgers[0].ledger.series[0].pretaxEquityCF,80);
 assert.throws(()=>appendV11IndicativeVATToLedgers({entityLedgers:once,vatCashAdjustments:diff}),/already applied/);
});

test("UI exposes editable effective tax/VAT assumptions and keeps ambiguous IRR visibly unavailable, not fictional 0%",()=>{
 const html=readFileSync(new URL("../preview/v11-dev.html",import.meta.url),"utf8");
 assert.match(html,/id="enable-indicative"/);
 assert.match(html,/id="clear-indicative"/);
 assert.match(html,/id="indicative-settings"/);
 assert.match(html,/data-approx-field/);
 assert.match(html,/data-approx-vat/);
 assert.match(html,/indicativeAssumptions/);
 assert.match(html,/indicativeAfterTax\.IRR/);
 assert.match(html,/fmt\(r\.indicativeAfterTax\.NPV\)/);
 assert.match(html,/annualIndicativeCashFlows/);
 assert.match(html,/概算税引後NPV/);
});
