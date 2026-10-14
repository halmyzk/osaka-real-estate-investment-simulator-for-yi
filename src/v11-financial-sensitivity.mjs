/**
 * Native-schema, NONMUTATING financial sensitivities.
 * Each isolated +/- shock alters one assumption only. A purchase-price
 * shock leaves gross disposal proceeds FIXED by recalculating implied
 * growth. A sale-price shock leaves acquisition basis FIXED.
 * Asset ledger basis is scaled proportionally with purchase so it still
 * reconciles. Only indicative investor analysis may reuse this simplified
 * cost allocation; the reviewed statutory sidecar is intentionally invalid.
 */
const finite=(n,k)=>{if(typeof n!=="number"||!Number.isFinite(n))throw new RangeError(k+" must be finite");return n;};
const bound=(n,k,min,max)=>{finite(n,k);if(n<min||n>max)throw new RangeError(k+" outside allowed bounds");return n};
const monthIndex=s=>Number(s.slice(0,4))*12+Number(s.slice(5,7))-1;
const dollarFields={adr:["H01","JPY_per_room_night"],occupancy:["H02","percent"],purchase:["A01","JPY"]};
export const v11FinancialShockKinds=Object.freeze(["adr","occupancy","purchase","sale"]);
function upsertField(doc,scenario,unit,id,value,fieldUnit){
 const overrides=scenario.overrides;
 const existing=overrides.find(x=>x.scope==="unit"&&x.targetId===unit.id&&x.fieldId===id);
 const newField={value,unit:fieldUnit,sourceType:"userAssumption"};
 if(existing)existing.field=newField;
 else overrides.push({scope:"unit",targetId:unit.id,fieldId:id,field:newField});
}
const lookup=(unit,scenario,id)=>{
 const row=scenario.overrides.find(x=>x.scope==="unit"&&x.targetId===unit.id&&x.fieldId===id);
 const value=row?.field?.value??unit.fields[id[0]]?.[id]?.value;
 if(typeof value!=="number"||!Number.isFinite(value))throw new RangeError("Scenario "+id+" not available for sensitivity");
 return value;
};
export function applyV11FinancialShock({
 document,scenarioId,unitId,kind,shockFraction
}){
 if(document?.schemaVersion!=="1.1.0")throw new TypeError("v1.1 model required");
 const copy=structuredClone(document);
 const original=document.units.find(x=>x.id===unitId);
 const unit=copy.units.find(x=>x.id===unitId);
 const scenario=copy.scenarios.find(x=>x.id===scenarioId);
 if(!unit||!original||!scenario)throw new RangeError("Unknown sensitivity unit/scenario");
 if(!v11FinancialShockKinds.includes(kind))throw new RangeError("Invalid financial shock kind");
 bound(shockFraction,"shockFraction",-.9,2);
 const growth=unit.exit.priceGrowthRate??document.portfolio.fields?.P?.P09?.value??0;
 const tenureYears=(monthIndex(unit.exit.exitDate.slice(0,7))-
   monthIndex(unit.startDate.slice(0,7))+1)/12;
 if(tenureYears<=0)throw new RangeError("Exit horizon must be positive");
 const purchase0=unit.tenure==="own"?lookup(unit,scenario,"A01"):null;
 const exit0=purchase0===null?null:purchase0*Math.pow(1+growth/100,tenureYears);
 if(["adr","occupancy"].includes(kind)){
   if(!["M1","M2","M3"].includes(unit.modelId))
     throw new RangeError("ADR and lodging occupancy shock requires lodging model");
   const [fieldId,unitName]=dollarFields[kind];
   const originalValue=lookup(unit,scenario,fieldId);
   const value=kind==="occupancy"?
     bound(originalValue*(1+shockFraction),"occupancy result",0,100):
     bound(originalValue*(1+shockFraction),"ADR result",0,Number.MAX_SAFE_INTEGER);
   upsertField(copy,scenario,unit,fieldId,value,unitName);
   return {document:copy,kind,originalValue,stressedValue:value,
     note:"One unit-level scenario override; stored Base fields unchanged"};
 }
 if(unit.tenure!=="own"||purchase0===null||purchase0<=0)
   throw new RangeError("Purchase and gross sale sensitivity require owned purchased property");
 if(kind==="sale"){
   if(exit0<=0)throw new RangeError("Gross sale price must be positive");
   const value=exit0*(1+shockFraction);
   // Do not edit P09 global scenario or other owned units.
   unit.exit.priceGrowthRate=100*(Math.pow(value/purchase0,1/tenureYears)-1);
   return {document:copy,kind,originalValue:exit0,stressedValue:value,
     note:"Gross disposal price adjusted on one property, acquisition unchanged"};
 }
 const value=purchase0*(1+shockFraction);
 if(value<=0)throw new RangeError("Acquisition price must be positive");
 upsertField(copy,scenario,unit,"A01",value,"JPY");
 // Proportionally revalue land + building tax ledger for this scenario only.
 const property=unit.assets?.filter(a=>["land","building"].includes(a.category))??[];
 if(property.length){
  if(property.length!==2||new Set(property.map(a=>a.category)).size!==2)
   throw new RangeError("Partial property asset ledger cannot be proportionally repriced");
  const basis=property.reduce((s,a)=>s+a.grossCost,0);
  if(Math.abs(basis-purchase0)>1e-6)
   throw new RangeError("Existing property ledger does not reconcile to source purchase price");
  const scale=value/purchase0;
  for(const a of property){
    a.grossCost*=scale;a.taxBasis*=scale;a.taxBookValue*=scale;
    if(a.source?.value!==undefined&&typeof a.source.value==="number")a.source.value*=scale;
  }
 }
 // Keep sale gross proceeds constant to make purchase-price comparison pure.
 if(exit0<=0)throw new RangeError("Gross sale price must be positive");
 unit.exit.priceGrowthRate=100*(Math.pow(exit0/value,1/tenureYears)-1);
 return {document:copy,kind,originalValue:purchase0,stressedValue:value,
   note:"Repriced owned acquisition and tax basis; gross disposal cash held fixed"};
}
