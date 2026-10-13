import test from "node:test";
import assert from "node:assert/strict";
import {verifyTaxRuleBundle,depreciateAssetTimeline} from "../src/tax-rules.mjs";
const source="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2100.htm";
const mk=(kind,from,to,basis="scenarioAssumption")=>({kind,version:"rule-"+from,
  validFrom:from,validUntil:to,taxpayerType:"individual",basis,
  eligibilityConfirmed:basis==="confirmed",sourceUrl:source});
test("year-aware tax configurations select rule by effective date, not current global constant",()=>{
 const rules=[mk("income","2026-01-01","2026-12-31"),mk("income","2027-01-01","2027-12-31")];
 assert.equal(verifyTaxRuleBundle({rules,periodStart:"2026-07-01",taxpayerType:"individual",requiredTaxKinds:["income"]}).rules.income.version,"rule-2026-01-01");
 assert.equal(verifyTaxRuleBundle({rules,periodStart:"2027-07-01",taxpayerType:"individual",requiredTaxKinds:["income"]}).rules.income.version,"rule-2027-01-01");
});
test("tax rule missing for applicable year does not silently assume no tax",()=>{
 const x=verifyTaxRuleBundle({rules:[mk("income","2026-01-01","2026-12-31")],periodStart:"2027-01-01",taxpayerType:"individual",requiredTaxKinds:["income","vat"]});
 assert.deepEqual(x.missingTaxKinds,["income","vat"]);assert.equal(x.status,"incomplete");
});
test("unverified confirmed classification and overlapping applicable rules are rejected",()=>{
 assert.throws(()=>verifyTaxRuleBundle({rules:[{...mk("income","2026-01-01","2026-12-31","confirmed"),eligibilityConfirmed:false}],
   periodStart:"2026-01-01",taxpayerType:"individual",requiredTaxKinds:["income"]}));
 assert.throws(()=>verifyTaxRuleBundle({rules:[mk("income","2026-01-01","2026-12-31"),mk("income","2026-06-01","2027-06-01")],
   periodStart:"2026-07-01",taxpayerType:"individual",requiredTaxKinds:["income"]}));
});
test("asset ledger separates initial cash CapEx from annual deductible depreciation and private use",()=>{
 const a=depreciateAssetTimeline({id:"fit",category:"furniture",openingBookValue:12000000,acquisitionBasis:12000000,
  annualRate:.1,method:"straightLine",years:[
    {taxYear:2026,inServiceMonths:12,businessUseRatio:.5,ruleBasis:"scenarioAssumption",sourceUrl:source},
    {taxYear:2027,inServiceMonths:12,businessUseRatio:.3,ruleBasis:"scenarioAssumption",sourceUrl:source}]});
 assert.equal(a.rows[0].deductibleDepreciation,600000);
 assert.equal(a.rows[1].deductibleDepreciation,360000);
 assert.equal(a.rows[0].grossBookReduction,1200000);
 assert.equal(a.closingBookValue,9600000);
});
test("land remains non-depreciable and unsupported tax methods cannot be guessed",()=>{
 const land=depreciateAssetTimeline({id:"land",category:"land",openingBookValue:8000000,acquisitionBasis:8000000,
  method:"nonDepreciable",years:[{taxYear:2026,inServiceMonths:12,businessUseRatio:1,ruleBasis:"confirmed",sourceUrl:source}]});
 assert.equal(land.rows[0].deductibleDepreciation,0);assert.equal(land.closingBookValue,8000000);
 assert.throws(()=>depreciateAssetTimeline({id:"x",category:"building",openingBookValue:1000,acquisitionBasis:1000,
  method:"decliningBalance",years:[]}));
});
