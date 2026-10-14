import test from "node:test";
import assert from "node:assert/strict";
import {applyStatutoryRounding,roundTaxStage} from "../src/tax-rounding.mjs";
const src="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm";
test("taxable-base 1000-yen floor is an explicit scenario, not display rounding",()=>{
 assert.equal(applyStatutoryRounding({value:1950999,increment:1000,method:"floor"}),1950000);
 assert.equal(applyStatutoryRounding({value:999,increment:1000,method:"floor"}),0);
 assert.equal(applyStatutoryRounding({value:19726.027,increment:1,method:"nearest"}),19726);
});
test("unknown year-specific tax rounding rule blocks tax result instead of using zero",()=>{
 const rules=[{taxYear:2026,taxKind:"incomeTax",stage:"taxableBase",increment:1000,method:"floor",
  version:"fixture-2026",basis:"scenarioAssumption",sourceUrl:src}];
 const a=roundTaxStage({value:3300555,taxYear:2026,taxKind:"incomeTax",stage:"taxableBase",rules});
 assert.equal(a.value,3300000);assert.equal(a.status,"estimated");
 const b=roundTaxStage({value:3300555,taxYear:2027,taxKind:"incomeTax",stage:"taxableBase",rules});
 assert.equal(b.status,"incomplete");assert.equal(b.value,null);
});
test("negative signed adjustment requires explicit allowance and rounding semantics",()=>{
 assert.throws(()=>applyStatutoryRounding({value:-1999,increment:1000,method:"truncate"}));
 assert.equal(applyStatutoryRounding({value:-1999,increment:1000,method:"truncate",signed:true}),-1000);
 assert.equal(applyStatutoryRounding({value:-1999,increment:1000,method:"floor",signed:true}),-2000);
});
test("duplicated rules are rejected and not arbitrarily preferred",()=>{
 const rule={taxYear:2026,taxKind:"incomeTax",stage:"taxableBase",increment:1000,method:"floor",
  version:"v",basis:"scenarioAssumption",sourceUrl:src};
 assert.throws(()=>roundTaxStage({value:1000,taxYear:2026,taxKind:"incomeTax",stage:"taxableBase",rules:[rule,rule]}));
});
