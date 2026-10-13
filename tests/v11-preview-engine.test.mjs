import test from "node:test";
import assert from "node:assert/strict";
import {inspectScenarioOverrides,resolveV11Field,numericPercent} from "../src/v11-field-resolver.mjs";
import {previewV11Scenario} from "../src/v11-preview-engine.mjs";
const f=(value,unit,sourceType="userAssumption")=>({value,unit,sourceType});
const cal=(year,month,model="M3",nights=15)=>{
 const days=new Date(Date.UTC(year,month,0)).getUTCDate();
 return {year,month,lodgingDays:model==="M4"?0:nights,
  rentalDays:model==="M4"?days:0,selfUseDays:model==="M3"?days-nights:0,
  changeoverDays:0,idleDays:model==="M1"?days-nights:0};
};
const lease=(id="lease",entity="individual")=>({
 id,name:id,modelId:"M4",tenure:"lease",operatorEntityId:entity,ownerEntityId:null,
 tenantEntityId:entity,startDate:"2026-01-01",operationStartDate:"2026-01-01",
 fields:{A:{A06:f(50000,"JPY_per_month"),A07:f(100000,"JPY"),A08:f(20000,"JPY")},
  R:{R01:f(100000,"JPY_per_month"),R02:f(90,"percent"),R05:f(1000,"JPY_per_month")}},
 calendar:[cal(2026,1,"M4")],expenses:[],assets:[],loans:[],
 exit:{method:"leaseSettlement",exitDate:"2026-01-31",sellingCosts:0,
  exitObligations:0,expectedDepositRefund:100000,applyResidentialRelief:false}
});
const owned=(id="own",entity="corp")=>({
 id,name:id,modelId:"M3",tenure:"own",operatorEntityId:entity,ownerEntityId:entity,
 tenantEntityId:null,startDate:"2026-01-01",operationStartDate:"2026-01-01",
 fields:{A:{A01:f(1000000,"JPY")},H:{H01:f(20000,"JPY_per_room_night"),
 H02:f(50,"percent")}},calendar:Array.from({length:12},(_,i)=>cal(2026,i+1)),
 expenses:[],assets:[],loans:[],
 exit:{method:"priceGrowth",exitDate:"2026-12-31",priceGrowthRate:0,
  sellingCosts:0,exitObligations:0,expectedDepositRefund:0,
  applyResidentialRelief:false}
});
const doc=(units=[lease()])=>({
 schemaVersion:"1.1.0",assumptionsVersion:"2026-10-13",
 portfolio:{id:"portfolio",name:"Demo",baseDate:"2026-01-01",holdingYears:1,
  currency:"JPY",fields:{P:{P04:f(8,"percent")}}},
 entities:[{id:"individual",name:"Individual",taxpayerType:"individual",fields:{}},
  {id:"corp",name:"Corporation",taxpayerType:"corporation",fields:{}}],
 units,scenarios:[{id:"base",name:"Base",role:"base",overrides:[]}]
});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test("V11 resolver scenario month > unit > documented default, with genuine zero retained",()=>{
 const d=doc([owned()]);
 d.units[0].calendar[0].fields={H:{H01:f(22000,"JPY_per_room_night")}};
 d.scenarios[0].overrides=[
  {scope:"unit",targetId:"own",fieldId:"H01",field:f(25000,"JPY_per_room_night")},
  {scope:"month",targetId:"own",year:2026,month:1,fieldId:"H02",field:f(0,"percent")}
 ];
 const c=inspectScenarioOverrides({document:d,scenarioId:"base"});
 assert.equal(resolveV11Field({document:d,scenarioContext:c,fieldId:"H01",
  unitId:"own",year:2026,month:1}).value,25000);
 const occ=resolveV11Field({document:d,scenarioContext:c,fieldId:"H02",
  unitId:"own",year:2026,month:1});
 assert.equal(occ.origin,"scenarioMonth");assert.equal(numericPercent(occ).value,0);
 assert.equal(resolveV11Field({document:d,scenarioContext:c,fieldId:"P07"}).value,60);
 const d2=doc([owned()]);
 d2.units[0].calendar[0].fields={H:{H01:f(22000,"JPY_per_room_night")}};
 const c2=inspectScenarioOverrides({document:d2,scenarioId:"base"});
 assert.equal(resolveV11Field({document:d2,scenarioContext:c2,fieldId:"H01",
  unitId:"own",year:2026,month:1}).value,22000);
});
test("Invalid repeated override and unknown target fail closed before any valuation",()=>{
 const d=doc([owned()]);
 const original={scope:"unit",targetId:"own",fieldId:"H01",field:f(20000,"JPY_per_room_night")};
 d.scenarios[0].overrides=[original,original];
 assert.throws(()=>inspectScenarioOverrides({document:d,scenarioId:"base"}),/duplicate/);
 d.scenarios[0].overrides=[{...original,targetId:"absent"}];
 assert.throws(()=>previewV11Scenario(d),/invalid or unsupported/);
});
test("Actual v1.1 lease M4 one-month forecast -> operating, CF0 refundable deposit, monthly refund and IRR",()=>{
 const r=previewV11Scenario(doc());
 assert.equal(r.status,"estimated-pre-tax");
 assert.equal(r.CF0,-120000);
 assert.deepEqual(r.preTax.cashFlows,[-120000,139000]);
 close(r.preTax.IRR,139000/120000-1);
 close(r.preTax.NPV,-120000+139000/1.08);
 assert.equal(r.afterTax,null);assert.equal(r.taxStatus,"incomplete");
 assert.equal(r.units[0].operating[0].result.rental.revenue,90000);
 assert.equal(r.units[0].operating[0].result.operatingSurplus,39000);
 assert.ok(r.inputWarnings.length>0);
});
test("M3 one owned lodging unit 180-day cap, 60% ramp, real months, year-end disposal no duplicated purchase",()=>{
 const r=previewV11Scenario(doc([owned()]));
 assert.equal(r.status,"estimated-pre-tax");
 assert.equal(r.CF0,-1000000);
 assert.equal(r.units[0].operating.length,12);
 assert.equal(r.units[0].operating[1].result.calendarDays,28);
 assert.equal(r.units[0].operating[0].result.lodging.revenue,90000);
 assert.equal(r.preTax.cashFlows[1],2080000);
 close(r.preTax.NPV,-1000000+2080000/1.08);
});
test("180-day maximum belongs to EACH unit, not consolidated 2 units",()=>{
 const a=owned("osaka","individual"),b=owned("tokyo","corp");
 const r=previewV11Scenario(doc([a,b]));
 assert.equal(r.status,"estimated-pre-tax");
 assert.equal(r.CF0,-2000000);
 assert.equal(r.preTax.cashFlows[1],4160000);
 assert.equal(r.afterTax,null); // no fictitious legal tax zero for the two entities
 a.calendar[0].lodgingDays=16;a.calendar[0].selfUseDays=15;
 assert.throws(()=>previewV11Scenario(doc([a,b])),/180-day/);
});
test("Missing ADR or incomplete monthly use freezes portfolio KPIs, not zero revenue",()=>{
 const d=doc([owned()]);
 delete d.units[0].fields.H.H01;
 const r=previewV11Scenario(d);
 assert.equal(r.status,"incomplete");assert.equal(r.preTax,null);
 assert.ok(r.missing.some(x=>x.fieldId==="H01"));
 const incomplete=doc([owned()]);
 incomplete.units[0].calendar.pop();
 const m=previewV11Scenario(incomplete);
 assert.equal(m.status,"incomplete");assert.ok(m.missing.some(x=>x.month==="2026-12"));
});
test("Date boundary and double booked rent rejected; no pre-opening lodging receipts",()=>{
 const d=doc([lease()]);
 d.units[0].startDate="2026-01-15";
 assert.throws(()=>previewV11Scenario(d),/partial/);
 const d2=doc([lease()]);
 d2.units[0].expenses=[{id:"head",entityId:"individual",category:"headRent",
  amount:50000,currency:"JPY",periodStart:"2026-01-01",periodEnd:"2026-01-31",
  cashDate:"2026-01-31",allocationMethod:"direct",taxTreatment:"deductible"}];
 assert.throws(()=>previewV11Scenario(d2),/master rent included twice/);
 const d3=doc([lease()]);
 d3.units[0].operationStartDate="2026-02-01";
 assert.throws(()=>previewV11Scenario(d3),/outside valuation horizon|start\/open\/exit/);
});
test("Same first-month own acquisition and disposal: acquisition/debt draw CF0, sale/debt payoff remain CF1",()=>{
 const u=owned();
 u.exit.exitDate="2026-01-31";u.calendar=u.calendar.slice(0,1);
 u.loans=[{id:"loan",borrowerEntityId:"corp",drawDate:"2026-01-01",
  principal:600000,annualInterestRate:0,termMonths:12,repaymentMethod:"annuity"}];
 const r=previewV11Scenario(doc([u]));
 assert.equal(r.status,"estimated-pre-tax");
 assert.equal(r.CF0,-400000);
 assert.deepEqual(r.preTax.cashFlows,[-400000,490000]);
});
test("Optional interest rate P04 missing means NPV incomplete, not zero discount rate",()=>{
 const d=doc();
 delete d.portfolio.fields.P.P04;
 const r=previewV11Scenario(d);
 assert.equal(r.status,"estimated-pre-tax");assert.equal(r.preTax.NPV,null);
 assert.equal(r.preTax.npvStatus,"incomplete");
 assert.ok(r.preTax.IRR!==null);
});


test("Gate C M4 rental days automatically follow real month length and annual growth when no use table",()=>{
 const u=lease();
 u.calendar=[];
 u.exit.exitDate="2027-12-31";
 u.exit.expectedDepositRefund=100000;
 const d=doc([u]);d.portfolio.holdingYears=2;
 const r=previewV11Scenario(d);
 assert.equal(r.status,"estimated-pre-tax");
 assert.equal(r.units[0].operating.length,24);
 assert.equal(r.units[0].operating[1].result.calendarDays,28);
 assert.equal(r.units[0].operating[12].result.calendarDays,31);
 close(r.units[0].operating[0].result.operatingSurplus,39000);
 close(r.units[0].operating[12].result.operatingSurplus,39880);
 close(r.annual[0].operating,39000*12);
 close(r.annual[1].operating,39880*12);
});
test("Scenario month override genuinely changes revenue while leaving other 11 months unchanged",()=>{
 const d=doc([owned()]);
 const baseline=previewV11Scenario(d);
 d.scenarios[0].overrides=[{scope:"month",targetId:"own",year:2026,month:1,
  fieldId:"H02",field:f(0,"percent")}];
 const changed=previewV11Scenario(d);
 assert.equal(changed.units[0].operating[0].result.lodging.revenue,0);
 assert.equal(changed.units[0].operating[1].result.lodging.revenue,90000);
 assert.equal(changed.preTax.cashFlows[1],baseline.preTax.cashFlows[1]-90000);
});
test("M2 combined lodging + rental month uses different calendar-day prorating, ADR and occupancy units",()=>{
 const u=lease();
 u.modelId="M2";
 u.calendar=[{year:2026,month:1,lodgingDays:15,rentalDays:10,selfUseDays:0,
    changeoverDays:2,idleDays:4}];
 u.fields.H={H01:f(30000,"JPY_per_room_night"),H02:f(60,"percent")};
 u.fields.R.R01=f(300000,"JPY_per_month");
 u.fields.R.R02=f(80,"percent");
 const r=previewV11Scenario(doc([u]));
 const op=r.units[0].operating[0].result;
 close(op.lodging.revenue,15*.6*.6*30000);
 close(op.rental.revenue,300000*10/31*.8);
 close(op.revenue,162000+300000*10/31*.8);
 assert.equal(op.lodging.allocatedDays,15);
 assert.equal(op.rental.allocatedDays,10);
});
test("Unsupported nonzero tax/financing assumptions, conflicting loan flags and scenario overrides are never silently ignored",()=>{
 const d=doc();
 d.units[0].fields.A.A04=f(100000,"JPY_per_year");
 assert.throws(()=>previewV11Scenario(d),/A04/);
 const d2=doc();d2.units[0].fields.F={F01:f(true,"boolean")};
 assert.throws(()=>previewV11Scenario(d2),/F01/);
 const d3=doc();d3.scenarios[0].overrides=[{scope:"portfolio",targetId:"portfolio",
  fieldId:"P03",field:f(3,"years")}];
 assert.throws(()=>previewV11Scenario(d3),/not yet supported/);
});
test("Documented null required rent stays incomplete, and unclassified K01 asset money blocks investment valuation",()=>{
 const d=doc();
 d.units[0].fields.R.R01=f(null,"JPY_per_month","unavailable");
 assert.equal(previewV11Scenario(d).status,"incomplete");
 const d2=doc();
 d2.units[0].fields.K={K01:f(300000,"JPY")};
 const result=previewV11Scenario(d2);
 assert.equal(result.status,"incomplete");
 assert.ok(result.missing.some(x=>x.fieldId==="K02"));
});
test("Separate tangible asset purchases enter initial financing CF0 exactly once and cannot include owned building twice",()=>{
 const u=owned();
 u.fields.K={K01:f(300000,"JPY")};
 u.assets=[{id:"furn",ownerEntityId:"corp",category:"furniture",grossCost:300000,
   taxBasis:300000,invoiceDate:"2026-01-01",inServiceDate:"2026-01-01",
   depreciationMethod:"straightLine",businessUseRatioByYear:[],taxBookValue:300000}];
 const r=previewV11Scenario(doc([u]));
 assert.equal(r.status,"estimated-pre-tax");
 assert.equal(r.CF0,-1300000);
 assert.equal(r.preTax.cashFlows[1],2080000);
 u.assets[0].category="building";
 assert.throws(()=>previewV11Scenario(doc([u])),/land\/building/);
});
