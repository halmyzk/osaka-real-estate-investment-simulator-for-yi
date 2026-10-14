import test from "node:test";
import assert from "node:assert/strict";
import {calculateOperatingMonth,validateAnnualLodgingAllocation} from "../src/operations.mjs";

const base={
  modelId:"M1",tenure:"own",calendarDays:30,
  lodgingDays:20,rentalDays:0,selfUseDays:0,changeoverDays:0,idleDays:10,
  lodging:{unavailableDays:0,occupancy:.5,adr:20000,ancillaryRevenue:0},
  costs:{lodgingOperating:70000,rentalOperating:0,propertyOperating:15000,masterRent:0},
  maintenanceCapEx:5000,deltaOperatingNWC:1000
};
const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test("Case 1: GOP excludes owner property expense and CapEx",()=>{
  const r=calculateOperatingMonth(base);
  assert.equal(r.lodging.soldRoomNights,10);
  assert.equal(r.lodging.GOP,130000);
  assert.equal(r.NOI,115000);
  assert.equal(r.preTaxCFADS,109000);
});
test("Case 2: hybrid lease rent deducted exactly once after NOI",()=>{
  const r=calculateOperatingMonth({...base,modelId:"M2",tenure:"lease",
    lodgingDays:15,rentalDays:10,idleDays:5,
    lodging:{unavailableDays:0,occupancy:.6,adr:30000,ancillaryRevenue:0},
    rental:{mode:"forecast",monthlyRent:300000,occupancy:.8,otherRevenue:0},
    costs:{lodgingOperating:20000,rentalOperating:5000,propertyOperating:5000,masterRent:150000},
    maintenanceCapEx:10000,deltaOperatingNWC:-2000
  });
  approx(r.lodging.revenue,270000);
  approx(r.rental.revenue,80000);
  approx(r.revenue,350000);
  approx(r.NOI,320000);
  approx(r.operatingSurplus,170000);
  approx(r.preTaxCFADS,162000);
});
test("Case 3: distinct unit operating days are additive, not unique dates",()=>{
  const u={...base,modelId:"M3",lodgingDays:15,selfUseDays:5,idleDays:10};
  const a=calculateOperatingMonth(u), b=calculateOperatingMonth(u);
  assert.equal(a.lodging.soldRoomNights+b.lodging.soldRoomNights,15);
});
test("Case 5: M4 has no lodging GOP",()=>{
  const r=calculateOperatingMonth({...base,modelId:"M4",lodgingDays:0,rentalDays:30,idleDays:0,
    rental:{mode:"forecast",monthlyRent:300000,occupancy:.9,otherRevenue:0},
    costs:{lodgingOperating:0,rentalOperating:10000,propertyOperating:20000,masterRent:0},
    maintenanceCapEx:0,deltaOperatingNWC:0});
  assert.equal(r.lodging.GOP,null);
  assert.equal(r.revenue,270000);
  assert.equal(r.NOI,240000);
});
test("forecast retains fractional room-nights",()=>{
  const r=calculateOperatingMonth({...base,lodging:{...base.lodging,occupancy:.33}});
  approx(r.lodging.soldRoomNights,6.6);
  approx(r.lodging.revenue,132000);
});
test("availability loss deducted only once, before occupancy",()=>{
  const r=calculateOperatingMonth({...base,lodging:{...base.lodging,unavailableDays:5,occupancy:.5}});
  assert.equal(r.lodging.availableRoomNights,15);
  assert.equal(r.lodging.soldRoomNights,7.5);
});
test("non-business days never generate lodging revenue",()=>{
  const r=calculateOperatingMonth({...base,modelId:"M3",lodgingDays:0,selfUseDays:20,idleDays:10,lodging:null,costs:{...base.costs,lodgingOperating:0}});
  assert.equal(r.revenue,0);
  assert.equal(r.preTaxCFADS,-21000);
});
test("negative pre-tax CFADS permitted and NWC release increases it",()=>{
  const r=calculateOperatingMonth({...base,lodging:{...base.lodging,occupancy:0},deltaOperatingNWC:-10000});
  assert.equal(r.preTaxCFADS,-80000);
});
test("missing expenses and invalid rates are not silently zeroed",()=>{
  assert.throws(()=>calculateOperatingMonth({...base,costs:{...base.costs,propertyOperating:undefined}}),RangeError);
  assert.throws(()=>calculateOperatingMonth({...base,lodging:{...base.lodging,occupancy:1.01}}),RangeError);
  assert.throws(()=>calculateOperatingMonth({...base,lodgingDays:31,idleDays:-1}),RangeError);
});
test("same physical unit: 180 allowed, 181 rejected",()=>{
  assert.deepEqual(validateAnnualLodgingAllocation("M3",[{year:2026,lodgingDays:90},{year:2026,lodgingDays:90}]),{"2026":180});
  assert.throws(()=>validateAnnualLodgingAllocation("M3",[{year:2026,lodgingDays:90},{year:2026,lodgingDays:91}]),RangeError);
});
test("lease master rent is not inside lodging GOP; owned unit rejects master rent",()=>{
  const lease=calculateOperatingMonth({...base,tenure:"lease",costs:{...base.costs,masterRent:100000}});
  assert.equal(lease.lodging.GOP,130000);
  assert.equal(lease.NOI,115000);
  assert.equal(lease.operatingSurplus,15000);
  assert.throws(()=>calculateOperatingMonth({...base,costs:{...base.costs,masterRent:1}}),RangeError);
});
