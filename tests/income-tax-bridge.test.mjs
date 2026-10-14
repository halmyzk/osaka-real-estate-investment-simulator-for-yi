import test from "node:test";
import assert from "node:assert/strict";
import {connectAnnualTaxAssessments} from "../src/income-tax-bridge.mjs";
import {evaluatePortfolio} from "../src/portfolio.mjs";
const url="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm";
const entities=[{entityId:"person",entityType:"individual"},{entityId:"corp",entityType:"corporation"}];
const mk=(entityId,taxKind,amount,year=2026)=>({
 id:entityId+"-"+taxKind+"-"+year,entityId,taxKind,amount,taxYear:year,
 status:"estimated",ruleVersion:"fixture-2026",sourceUrl:url
});
test("individual and corporate baseline/project tax assessed then routed to distinct payment months",()=>{
 const withProject=[mk("person","incomeTax",40000),mk("corp","corporateTax",70000)];
 const withoutProject=[mk("person","incomeTax",30000),mk("corp","corporateTax",50000)];
 const r=connectAnnualTaxAssessments({entities,assessmentsWithProject:withProject,assessmentsWithoutProject:withoutProject});
 assert.equal(r.incrementalTaxCF,-30000);
 assert.deepEqual(r.entries.map(x=>[x.entityId,x.month,x.incrementalTaxCF]),
  [["corp","2027-02",-20000],["person","2027-03",-10000]]);
 const empty={series:[]};
 const p=evaluatePortfolio({entityLedgers:entities.map(x=>({entityId:x.entityId,ledger:empty})),
   baseCalendarYear:2026,holdingYears:1,taxes:r.entries,
   taxCoverage:entities.map(x=>({entityId:x.entityId,status:"estimated"})),
   discountRate:.08});
 assert.deepEqual(p.afterTax.cashFlows,[0,0,-30000]);
 assert.equal(p.taxStatus,"estimated");
});
test("missing baseline is not zero tax and VAT cannot be doubled into income tax ledger",()=>{
 assert.throws(()=>connectAnnualTaxAssessments({entities,assessmentsWithProject:[mk("person","incomeTax",10000)],assessmentsWithoutProject:[]}));
 assert.throws(()=>connectAnnualTaxAssessments({entities,assessmentsWithProject:[mk("corp","consumptionTax",10000)],assessmentsWithoutProject:[mk("corp","consumptionTax",0)]}));
});
test("tax kind belongs to correct legal entity; unknown assessment status cannot silently pass",()=>{
 assert.throws(()=>connectAnnualTaxAssessments({entities,assessmentsWithProject:[mk("person","corporateTax",1000)],assessmentsWithoutProject:[mk("person","corporateTax",0)]}));
 assert.throws(()=>connectAnnualTaxAssessments({entities,assessmentsWithProject:[{...mk("person","incomeTax",1000),status:"incomplete"}],assessmentsWithoutProject:[mk("person","incomeTax",0)]}));
});
test("explicit zero with/without-project tax stays zero",()=>{
 const r=connectAnnualTaxAssessments({entities,assessmentsWithProject:[mk("person","incomeTax",0)],assessmentsWithoutProject:[mk("person","incomeTax",0)]});
 assert.equal(r.incrementalTaxCF,0);
});
