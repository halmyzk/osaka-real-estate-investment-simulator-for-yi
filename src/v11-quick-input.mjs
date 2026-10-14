/**
 * User-facing QUICK inputs on native v1.1 document. The original is never
 * mutated until the caller explicitly applies the returned new document.
 * Recurring expense amounts are MONTHLY and are stored as explicit complete
 * cash-date lines (not also placed in H10/H12/R05/A05).
 * A renovation is CAPEX in native asset register, never operating expense.
 * Scope: one cost per calendar month, from first to last month inclusive.
 */
const kinds=Object.freeze({
 utilities:{label:"共通光熱費",category:"propertyOperating",method:"areaTimesGuestNights",vatSupplier:"potentiallyTaxable"},
 insurance:{label:"保険料",category:"propertyOperating",method:"areaTimesBusinessPeriod",vatSupplier:"exemptAssumption"},
 propertyTax:{label:"固定資産税",category:"propertyOperating",method:"areaTimesBusinessPeriod",vatSupplier:"outOfScope"},
 management:{label:"管理・運営委託費",category:"lodgingOperating",method:"direct",vatSupplier:"potentiallyTaxable"},
 rentalManagement:{label:"賃貸管理料",category:"rentalOperating",method:"direct",vatSupplier:"potentiallyTaxable"}
});
export const v11QuickExpenseKinds=kinds;
const ym=s=>{if(typeof s!=="string"||!/^\d{4}-(0[1-9]|1[0-2])$/.test(s))throw new RangeError("YYYY-MM required");return s};
const i=s=>Number(s.slice(0,4))*12+Number(s.slice(5,7))-1;
const from=i=>Math.floor(i/12)+"-"+String(i%12+1).padStart(2,"0");
const end=s=>s+"-"+String(new Date(Date.UTC(Number(s.slice(0,4)),Number(s.slice(5,7)),0)).getUTCDate()).padStart(2,"0");
const amount=(n,k)=>{if(typeof n!=="number"||!Number.isFinite(n)||n<0)throw new RangeError(k+" must be nonnegative finite");return n};
const locate=(d,unitId)=>{
 if(d?.schemaVersion!=="1.1.0"||!Array.isArray(d.units))throw new TypeError("v1.1 document required");
 const unit=d.units.find(u=>u.id===unitId);
 if(!unit)throw new RangeError("Unknown unit ID");
 return unit;
};
const rows=(fromMonth,toMonth,unit)=>{
 const start=ym(fromMonth),finish=ym(toMonth);
 if(i(finish)<i(start)||i(finish)-i(start)>600)throw new RangeError("Invalid months range");
 if(start<unit.operationStartDate.slice(0,7)||finish>unit.exit.exitDate.slice(0,7))
  throw new RangeError("Expenses must be within opening/exit operating months");
 return Array.from({length:i(finish)-i(start)+1},(_,j)=>from(i(start)+j));
};
const ownedId=(kind,m)=>"quick-"+kind+"-"+m;
export function setV11QuickExpense({
 document,unitId,kind,monthlyAmount,fromMonth,toMonth
}){
 if(!(kind in kinds))throw new RangeError("Unknown quick expense kind");
 amount(monthlyAmount,"monthlyAmount");
 const copy=structuredClone(document),unit=locate(copy,unitId);
 if(kind==="propertyTax"&&unit.tenure!=="own")
  throw new RangeError("Property tax quick preset only for owned real estate");
 if(kind==="management"&&!["M1","M2","M3"].includes(unit.modelId))
  throw new RangeError("Lodging management requires lodging model");
 if(kind==="rentalManagement"&&!["M2","M4"].includes(unit.modelId))
  throw new RangeError("Rental management requires rental model");
 const months=rows(fromMonth,toMonth,unit);
 const proposed=new Set(months.map(m=>ownedId(kind,m)));
 const prior=unit.expenses??[];
 if(prior.some(e=>proposed.has(e.id)&&!e.description?.startsWith("[quick:"+kind+"]")))
  throw new RangeError("Expense ID conflict with manually entered data");
 const pruned=prior.filter(e=>!proposed.has(e.id));
 const preset=kinds[kind];
 for(const m of months)if(monthlyAmount>0){
  pruned.push({id:ownedId(kind,m),unitId,entityId:unit.operatorEntityId,
   category:preset.category,description:"[quick:"+kind+"] "+preset.label,
   amount:monthlyAmount,currency:"JPY",periodStart:m+"-01",periodEnd:end(m),
   cashDate:end(m),fixedOrVariable:"fixed",
   allocationMethod:unit.modelId==="M3"?preset.method:"direct",
   taxTreatment:"deductible"});
 }
 unit.expenses=pruned;
 return {document:copy,count:months.length,kind,total:monthlyAmount*months.length,
  message:kind+" recorded as explicit monthly cash, not field-derived recurring cost"};
}
export function setV11QuickOTA({document,unitId,percentage}){
 amount(percentage,"OTA percent");if(percentage>100)throw new RangeError("OTA percent over 100");
 const copy=structuredClone(document),unit=locate(copy,unitId);
 if(!["M1","M2","M3"].includes(unit.modelId))throw new RangeError("OTA only for lodging");
 unit.fields.H??={};
 unit.fields.H.H08={value:percentage,unit:"percent",sourceType:"userAssumption"};
 // H08 applies dynamically as percentage of room revenue and is already
 // charged once in Gate A. Never add another OTA explicit expense.
 return {document:copy,kind:"ota",percentage};
}
export function addV11QuickRenovation({document,unitId,month,cost,label="改修・FF&E（概算）"}){
 amount(cost,"renovation cost");if(cost===0)throw new RangeError("Renovation must be positive");
 ym(month);if(typeof label!=="string"||!label.trim())throw new RangeError("Asset label required");
 const copy=structuredClone(document),unit=locate(copy,unitId);
 if(month<unit.startDate.slice(0,7)||month>unit.exit.exitDate.slice(0,7))
  throw new RangeError("Renovation outside holding period");
 const category=unit.tenure==="own"?"buildingEquipment":"leaseholdImprovement";
 unit.assets??=[];
 const ids=new Set(unit.assets.map(a=>a.id));
 let serial=1;while(ids.has("quick-renovation-"+month+"-"+serial))serial++;
 const asset={
  id:"quick-renovation-"+month+"-"+serial,unitId,ownerEntityId:unit.operatorEntityId,
  category,grossCost:cost,taxBasis:cost,taxBookValue:cost,
  invoiceDate:month+"-01",inServiceDate:month+"-01",
  usefulLifeYears:10,depreciationMethod:"straightLine",
  privateUseAdjustment:"unknown",businessUseRatioByYear:[],
  priorAccumulatedDepreciation:0,
  source:{value:cost,unit:"JPY",sourceType:"userAssumption"}
 };
 unit.assets.push(asset);
 const total=unit.assets.filter(a=>a.category!=="land"&&a.category!=="building")
  .reduce((s,a)=>s+amount(a.grossCost,"other asset gross cost"),0);
 unit.fields.K??={};
 unit.fields.K.K01={value:total,unit:"JPY",sourceType:"userAssumption"};
 return {document:copy,assetId:asset.id,cost,month,
  warning:"CapEx cash is included once; tax depreciation/remaining resale basis of renovation is NOT modeled in indicative taxes"};
}
