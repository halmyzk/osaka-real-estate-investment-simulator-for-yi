import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateBusinessExpense,depreciateAssetYear,officerHousingBenefit,nationalPersonalIncomeTax,
  corporateNationalTax,consumptionTax,landBuildingSaleGain,applyIndividualIncomeCategories,
  incrementalTaxEvents,applyTaxToPretaxLedger
} from "../src/tax.mjs";
import {compilePretaxLedger,investingEvents} from "../src/finance.mjs";
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} !== ${b}`);
test("B-T06 actual nights, not 180-day allocation, apportion 240k utilities",()=>{
 const o=allocateBusinessExpense({expense:240000,method:"areaGuestNights",areaBusiness:60,areaTotal:180,actualGuestNights:90,daysInYear:365});
 close(o.amount,19726.02739726027);assert.equal(Math.round(o.amount),19726);
 assert.equal(allocateBusinessExpense({expense:240000,method:"private"}).amount,0);
 assert.throws(()=>allocateBusinessExpense({expense:240000,method:"areaGuestNights",areaBusiness:60,areaTotal:180,actualGuestNights:400,daysInYear:365}));
});
test("B-T08/09/22: noncash depreciation separate from capex; land not depreciated",()=>{
 const asset=depreciateAssetYear({category:"building",method:"straightLine",openingTaxBookValue:12000000,
  acquisitionTaxBasis:12000000,annualRate:.1,inServiceMonths:12,businessUseShare:.5});
 assert.equal(asset.deductibleDepreciation,600000);
 assert.equal(asset.closingTaxBookValue,10800000);
 const land=depreciateAssetYear({category:"land",method:"nonDepreciable",openingTaxBookValue:10000000,acquisitionTaxBasis:10000000,
  inServiceMonths:12,businessUseShare:1});
 assert.equal(land.deductibleDepreciation,0);
 assert.throws(()=>depreciateAssetYear({category:"building",method:"decliningBalance",openingTaxBookValue:1000,acquisitionTaxBasis:1000,inServiceMonths:12,businessUseShare:1}));
});
test("B-T12/13: small vs luxury housing, zero rent benefit",()=>{
 const small=officerHousingBenefit({classification:"small",actualOfficerRent:10000,buildingFixedTaxBase:2000000,landFixedTaxBase:5000000,floorAreaSqm:99});
 assert.equal(small.rentEquivalent,15360);
 assert.equal(small.taxableOfficerBenefit,5360);
 assert.equal(officerHousingBenefit({classification:"luxury",actualOfficerRent:0,normalMonthlyRent:450000}).taxableOfficerBenefit,450000);
 assert.throws(()=>officerHousingBenefit({classification:"unknown",actualOfficerRent:0}));
});
test("B-T03/04 individual national progressive and year-specific surtax components",()=>{
 const a=nationalPersonalIncomeTax({taxYear:2026,taxableIncome:1950000});
 assert.equal(a.nationalIncomeTax,97500);
 close(a.surcharges.reconstruction,2047.5);
 assert.equal(a.surcharges.defenseIncome,0);
 const b=nationalPersonalIncomeTax({taxYear:2027,taxableIncome:3300000});
 assert.equal(b.nationalIncomeTax,232500);
 close(b.surcharges.reconstruction,2557.5);close(b.surcharges.defenseIncome,2325);
});
test("B1 misc loss never offsets salary; real-estate loss only if eligible",()=>{
 const entries=[{category:"miscellaneous",amount:-500000},{category:"realEstate",amount:-200000}];
 assert.equal(applyIndividualIncomeCategories({baselineOrdinaryTaxableIncome:4000000,projectCategories:entries}).adjustedTaxableIncome,4000000);
 assert.equal(applyIndividualIncomeCategories({baselineOrdinaryTaxableIncome:4000000,projectCategories:entries,eligibleRealEstateLossOffset:true}).adjustedTaxableIncome,3800000);
});
test("B corporate income tax requires eligible company designation, local tax remains unknown",()=>{
 const t=corporateNationalTax({taxYear:2026,taxableIncome:10000000,eligibleSmallCompany:true});
 close(t.corporateNationalTax,1664000);
 assert.equal(t.localCorporateTax,"unknown");
 assert.throws(()=>corporateNationalTax({taxYear:2026,taxableIncome:10000000}));
});
test("B VAT exempt cannot request input credit, general vs simplified",()=>{
 const exempt=consumptionTax({status:"exempt",mode:"general",outputVAT:0,inputVAT:100000,eligibleInputVAT:100000});
 assert.equal(exempt.refund,0);
 const general=consumptionTax({status:"taxable",mode:"general",outputVAT:100000,inputVAT:50000,eligibleInputVAT:30000});
 assert.equal(general.payment,70000);
 const simple=consumptionTax({status:"taxable",mode:"simplified",outputVAT:100000,simplifiedTaxableSales:1000000,deemedPurchaseRate:.5});
 assert.equal(simple.payment,50000);
 assert.equal(consumptionTax({status:"taxable",mode:"general",outputVAT:10000,inputVAT:30000,eligibleInputVAT:30000}).status,"incomplete");
});
test("B-T18 held >5 years on sale year January 1, no automatic housing relief",()=>{
 const s=landBuildingSaleGain({ownerType:"individual",purchaseDate:"2020-12-31",saleDate:"2026-12-31",
  proceeds:11000000,sellingCosts:500000,adjustedLandBasis:4500000,adjustedBuildingBasis:5000000});
 assert.equal(s.holdingClass,"long");assert.equal(s.taxableGain,1000000);
 const short=landBuildingSaleGain({ownerType:"individual",purchaseDate:"2021-01-01",saleDate:"2026-12-31",
  proceeds:11000000,sellingCosts:500000,adjustedLandBasis:4500000,adjustedBuildingBasis:5000000});
 assert.equal(short.holdingClass,"short");
 assert.throws(()=>landBuildingSaleGain({ownerType:"individual",purchaseDate:"2020-12-31",saleDate:"2026-12-31",
  proceeds:11000000,sellingCosts:500000,adjustedLandBasis:4500000,adjustedBuildingBasis:5000000,eligibleSpecialDeduction:3000000}));
});
test("B-T20: tax paid year 11 remains in 10-year sale CF series",()=>{
 const inv=investingEvents({disposals:[{id:"sale",month:"2035-12",proceeds:11000000,sellingCosts:500000}]});
 const pretax=compilePretaxLedger({investing:inv});
 const t=incrementalTaxEvents({withProject:[{id:"sale-tax",entityId:"person-1",month:"2036-03",taxKind:"saleGainTax",amount:200000}],
   withoutProject:[]});
 const after=applyTaxToPretaxLedger(pretax,t);
 assert.equal(after.series.at(-1).month,"2036-03");
 assert.equal(after.series.at(-1).afterTaxEquityCF,-200000);
 assert.equal(after.totals.pretaxEquityCF,10500000);
 assert.equal(after.totals.afterTaxEquityCF,10300000);
});
test("B-T21 incremental tax zero, distinct entity baselines, confirmed refund only",()=>{
 const pretax=compilePretaxLedger({});
 const input=[{id:"x",entityId:"corp-A",month:"2027-02",taxKind:"corporateTax",amount:10000}];
 const t=incrementalTaxEvents({withProject:input,withoutProject:input});
 assert.equal(t.incrementalTaxCF,0);
 assert.equal(applyTaxToPretaxLedger(pretax,t).totals.afterTaxEquityCF,0);
 assert.throws(()=>incrementalTaxEvents({withProject:[{id:"r",entityId:"person",month:"2027-03",taxKind:"incomeTax",amount:-1000}],withoutProject:[]}));
 const refund=incrementalTaxEvents({withProject:[{id:"r",entityId:"person",month:"2027-03",taxKind:"incomeTax",amount:-1000,refundConfirmed:true}],withoutProject:[]});
 assert.equal(refund.incrementalTaxCF,1000);
});
test("B missing taxable income does not become favorable zero",()=>{
 assert.throws(()=>nationalPersonalIncomeTax({taxYear:2026,taxableIncome:null}));
 assert.throws(()=>corporateNationalTax({taxYear:2026,taxableIncome:1000000,eligibleSmallCompany:null}));
});
