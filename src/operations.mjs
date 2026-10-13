/**
 * Gate A §13.1–13.4: pure, tax-free monthly operating engine.
 *
 * One physical unit, one calendar month. All cash amounts nominal JPY,
 * occupancy as decimal 0..1 (not percent). The caller must explicitly
 * supply 0 for actual zero expenses; undefined/null is not interpreted as 0.
 *
 * Lodging GOP, property NOI, pre-master-rent surplus, post-rent surplus,
 * and pre-tax CFADS are distinct. Debt, tax, acquisition and sale cash
 * flows deliberately belong to later modules.
 */
const finite = (v, key, {min = -Infinity, max = Infinity} = {}) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    throw new RangeError(`${key} must be a finite number between ${min} and ${max}`);
  }
  return v;
};
const whole = (v, key) => {
  finite(v, key, {min:0});
  if (!Number.isInteger(v)) throw new RangeError(`${key} must be an integer`);
  return v;
};
const money = (v, key) => finite(v, key, {min:0});
const ratio = (v, key) => finite(v, key, {min:0, max:1});

export function calculateOperatingMonth({
  modelId, tenure, calendarDays, lodgingDays, rentalDays,
  selfUseDays, changeoverDays, idleDays, lodging,
  rental, costs, maintenanceCapEx, deltaOperatingNWC
}) {
  if (!["M1","M2","M3","M4"].includes(modelId)) throw new RangeError("Invalid modelId");
  if (!["own","lease"].includes(tenure)) throw new RangeError("Invalid tenure");
  whole(calendarDays,"calendarDays");
  if (calendarDays < 28 || calendarDays > 31) throw new RangeError("Invalid calendar month length");
  const days={lodgingDays,rentalDays,selfUseDays,changeoverDays,idleDays};
  for (const [k,v] of Object.entries(days)) whole(v,k);
  if (Object.values(days).reduce((a,b)=>a+b,0)!==calendarDays) throw new RangeError("Calendar allocation must equal days in month");
  if (modelId==="M1" && (rentalDays!==0 || selfUseDays!==0)) throw new RangeError("M1 incompatible purpose");
  if (modelId==="M2" && selfUseDays!==0) throw new RangeError("M2 incompatible purpose");
  if (modelId==="M3" && rentalDays!==0) throw new RangeError("M3 incompatible purpose");
  if (modelId==="M4" && lodgingDays!==0) throw new RangeError("M4 incompatible purpose");

  if (!costs || typeof costs!=="object") throw new TypeError("costs required");
  // Expense ownership must be explicit to prevent duplicate deduction.
  const lodgingOperating = money(costs.lodgingOperating,"costs.lodgingOperating");
  const rentalOperating = money(costs.rentalOperating,"costs.rentalOperating");
  const propertyOperating = money(costs.propertyOperating,"costs.propertyOperating");
  const masterRent = money(costs.masterRent,"costs.masterRent");
  if (tenure==="own" && masterRent!==0) throw new RangeError("Owned property cannot have master rent expense");
  if (modelId==="M4" && lodgingOperating!==0) throw new RangeError("M4 cannot have lodging operating expense");
  if (modelId==="M1" && rentalOperating!==0) throw new RangeError("M1 cannot have rental operating expense");
  if (modelId==="M3" && rentalOperating!==0) throw new RangeError("M3 cannot have rental operating expense");
  if (modelId==="M2" && !rental && rentalDays>0) throw new RangeError("Rental settings required");
  const capex = money(maintenanceCapEx,"maintenanceCapEx");
  const nwcDelta = finite(deltaOperatingNWC,"deltaOperatingNWC");

  let soldRoomNights=0,availableRoomNights=0,lodgingRevenue=0;
  let occupancy=null,adr=null,ancillaryRevenue=0;
  if (lodgingDays>0) {
    if (!lodging || typeof lodging!=="object") throw new TypeError("Lodging settings required");
    const unavailable=whole(lodging.unavailableDays,"lodging.unavailableDays");
    if (unavailable>lodgingDays) throw new RangeError("Unavailable lodging days exceed allocation");
    occupancy=ratio(lodging.occupancy,"lodging.occupancy");
    adr=money(lodging.adr,"lodging.adr");
    ancillaryRevenue=money(lodging.ancillaryRevenue,"lodging.ancillaryRevenue");
    availableRoomNights=lodgingDays-unavailable;
    soldRoomNights=availableRoomNights*occupancy;
    lodgingRevenue=soldRoomNights*adr+ancillaryRevenue;
  } else if (lodging) {
    // Preserve explicit model data but do not create a sale on unallocated days.
    if (lodging.ancillaryRevenue!==undefined && lodging.ancillaryRevenue!==0)
      throw new RangeError("Ancillary lodging revenue without lodging allocation");
  }

  let rentalRevenue=0, rentOccupancy=null,monthlyRent=null,otherRentRevenue=0;
  if (rentalDays>0) {
    if (!rental || typeof rental!=="object") throw new TypeError("Rental settings required");
    if (rental.mode!=="forecast") throw new RangeError("Only forecast rental mode is implemented");
    rentOccupancy=ratio(rental.occupancy,"rental.occupancy");
    monthlyRent=money(rental.monthlyRent,"rental.monthlyRent");
    otherRentRevenue=money(rental.otherRevenue,"rental.otherRevenue");
    rentalRevenue=monthlyRent*rentalDays/calendarDays*rentOccupancy+otherRentRevenue;
  } else if (rental?.otherRevenue!==undefined && rental.otherRevenue!==0) {
    throw new RangeError("Rent ancillary revenue without rental allocation");
  }

  // No occupancy-dependent expense inference: caller computes e.g. cleanings
  // from explicit booking assumptions and supplies expense amount once.
  const revenue=lodgingRevenue+rentalRevenue;
  const operatingExpenses=lodgingOperating+rentalOperating+propertyOperating;
  const lodgingGOP=modelId==="M4" ? null : lodgingRevenue-lodgingOperating;
  const noiBeforeMasterRent=revenue-operatingExpenses;
  const operatingSurplus=noiBeforeMasterRent-masterRent;
  const preTaxCFADS=operatingSurplus-capex-nwcDelta;
  return {
    modelId,tenure,calendarDays,
    lodging: {allocatedDays:lodgingDays,availableRoomNights,soldRoomNights,occupancy,adr,ancillaryRevenue,revenue:lodgingRevenue,GOP:lodgingGOP},
    rental: {allocatedDays:rentalDays,occupancy:rentOccupancy,monthlyRent,otherRevenue:otherRentRevenue,revenue:rentalRevenue},
    revenue,expenses:{lodgingOperating,rentalOperating,propertyOperating,masterRent,maintenanceCapEx:capex,deltaOperatingNWC:nwcDelta},
    NOI:noiBeforeMasterRent,preMasterRentOperatingSurplus:noiBeforeMasterRent,operatingSurplus,preTaxCFADS,
    status:"computed",taxCashPayment:"notImplemented",afterTaxCFADS:"notImplemented",debtService:"notImplemented"
  };
}

/** Prevent implicit whole-portfolio overstatement of a unit's 180-day cap. */
export function validateAnnualLodgingAllocation(modelId, monthlyInputs) {
  if (!["M1","M2","M3","M4"].includes(modelId)) throw new RangeError("Invalid modelId");
  const byYear=new Map();
  for(const {year,lodgingDays} of monthlyInputs) {
    if(!Number.isInteger(year)) throw new RangeError("year must be integer");
    whole(lodgingDays,"lodgingDays");
    byYear.set(year,(byYear.get(year)||0)+lodgingDays);
  }
  if (["M2","M3"].includes(modelId)) {
    for(const [year,total] of byYear) if(total>180) throw new RangeError(`180-day unit limit exceeded in ${year}`);
  }
  return Object.fromEntries(byYear);
}
