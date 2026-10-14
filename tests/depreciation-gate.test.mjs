import test from "node:test";
import assert from "node:assert/strict";
import {verifyDepreciationPrerequisites} from "../src/depreciation-gate.mjs";
const asset={id:"a1",ownerEntityId:"corp",unitId:"osaka1",taxBasis:12000000,
 acquisitionDate:"2026-01-01",inServiceDate:"2026-04-01",
 category:"building",method:"straightLine",usefulLifeYears:20};
const rule={assetCategory:"building",method:"straightLine",annualRate:.05,
 validFrom:"2026-01-01",validUntil:"2026-12-31",sourceUrl:"https://www.nta.go.jp/",
 applicability:"scenarioAssumption"};
test("asset category, in-service date, method, source and acquisition year are explicitly screened",()=>{
 const a=verifyDepreciationPrerequisites({asset,taxYear:2026,rule});
 assert.equal(a.status,"estimated");assert.equal(a.canComputeNumericalDepreciation,true);
 const b=verifyDepreciationPrerequisites({asset,taxYear:2025,rule});
 assert.equal(b.status,"incomplete");
 const c=verifyDepreciationPrerequisites({asset:{...asset,method:"decliningBalance"},taxYear:2026,rule});
 assert.equal(c.status,"incomplete");
});
test("land depreciation and rate source missing cannot silently be treated as valid",()=>{
 const land=verifyDepreciationPrerequisites({asset:{...asset,category:"land"},taxYear:2026,rule});
 assert.equal(land.status,"incomplete");
 const wrongRate=verifyDepreciationPrerequisites({asset,taxYear:2026,rule:{...rule,annualRate:null}});
 assert.equal(wrongRate.canComputeNumericalDepreciation,false);
 const unverified=verifyDepreciationPrerequisites({asset,taxYear:2026,rule:{...rule,applicability:"unverified"}});
 assert.equal(unverified.status,"incomplete");
});
