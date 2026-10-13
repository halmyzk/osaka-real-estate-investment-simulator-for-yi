import test from "node:test";
import assert from "node:assert/strict";
import {calculateStatutoryAssetSchedule,depreciationTaxItems} from "../src/statutory-depreciation.mjs";
const source="https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/5410.htm";
const asset=(method,category="furniture",acquired="2012-04-01")=>({
 assetId:method+"-asset",unitId:"unit-1",ownerEntityId:"corp-1",
 taxCategory:"corporate",category,method,fiscalYearEndMonth:3,acquisitionBasis:1000000,
 acquisitionDate:acquired,inServiceDate:acquired,usefulLifeYears:8
});
const rule=(method,category="furniture",acquired="2012-04-01")=>({
 version:"NTA-5410-8Y-2012",sourceUrl:source,assetCategory:category,method,
 eligibility:"reviewedScenario",validFrom:acquired,validUntil:"2040-12-31",
 annualRate:method==="straightLine"?.125:.25,guaranteeRate:.07909,
 revisedAnnualRate:.334
});
const years=(start,share=1)=>Array.from({length:8},(_,i)=>({taxYear:start+i,inServiceMonths:12,
 businessUseShare:share,allocationEvidenceUrl:source}));
test("B-T08 NTA No.5410 8-year straight line: exact 125000 and final 124999, 1 yen book",()=>{
 const x=calculateStatutoryAssetSchedule({asset:asset("straightLine","furniture","2007-04-01"),
  methodRule:{...rule("straightLine","furniture","2007-04-01"),version:"NTA-5410-8Y-2007"},years:years(2008)});
 assert.deepEqual(x.lines.map(r=>r.grossBookReduction),[125000,125000,125000,125000,125000,125000,125000,124999]);
 assert.equal(x.closingBookValue,1);
 assert.equal(x.lines.reduce((s,r)=>s+r.grossBookReduction,0),999999);
});
test("B-T08 NTA No.5410 official 200% declining example including guarantee switch",()=>{
 const x=calculateStatutoryAssetSchedule({asset:asset("decliningBalance"),methodRule:rule("decliningBalance"),years:years(2013)});
 assert.deepEqual(x.lines.map(r=>r.grossBookReduction),[250000,187500,140625,105468,79101,79260,79260,78785]);
 assert.deepEqual(x.lines.map(r=>r.closingBookValue),[750000,562500,421875,316407,237306,158046,78786,1]);
 assert.equal(x.lines[5].calculationMethod,"decliningBalanceRevised");
 assert.equal(x.closingBookValue,1);
});
test("B-T10 business use 50% to 30% changes noncash deductible expense, not gross tax book reduction",()=>{
 const x=calculateStatutoryAssetSchedule({asset:asset("straightLine"),
  methodRule:rule("straightLine"),years:[
    {...years(2013)[0],businessUseShare:.5},
    {...years(2013)[1],businessUseShare:.3}
  ]});
 assert.equal(x.lines[0].businessDeduction,62500);
 assert.equal(x.lines[1].businessDeduction,37500);
 assert.equal(x.lines[0].grossBookReduction,x.lines[1].grossBookReduction);
 const items=depreciationTaxItems({assetSchedules:[x],taxYear:2014});
 assert.deepEqual(items,[{entityId:"corp-1",taxYear:2014,category:"corporate",kind:"depreciation",
  amount:37500,sourceAssetId:"straightLine-asset",noncash:true}]);
});
test("Land has zero depreciation; building and post-2016 equipment cannot use declining",()=>{
 const landAsset={...asset("straightLine","land"),method:"nonDepreciable",assetId:"land-1"};
 const land=calculateStatutoryAssetSchedule({asset:landAsset,
  methodRule:rule("nonDepreciable","land"),years:years(2012)});
 assert.ok(land.lines.every(x=>x.grossBookReduction===0));
 assert.equal(land.closingBookValue,1000000);
 assert.throws(()=>calculateStatutoryAssetSchedule({asset:asset("decliningBalance","building"),
  methodRule:rule("decliningBalance","building"),years:years(2012)}));
 assert.throws(()=>calculateStatutoryAssetSchedule({asset:asset("decliningBalance","buildingEquipment","2026-04-01"),
  methodRule:rule("decliningBalance","buildingEquipment","2026-04-01"),years:years(2027)}));
});
test("Missing year's asset record or duplicate assets cannot silently zero annual taxable expense",()=>{
 const x=calculateStatutoryAssetSchedule({asset:asset("straightLine"),methodRule:rule("straightLine"),years:years(2012)});
 assert.throws(()=>depreciationTaxItems({assetSchedules:[x],taxYear:2040}));
 assert.throws(()=>depreciationTaxItems({assetSchedules:[x,x],taxYear:2013}));
});
