/**
 * Gate D developer-only v1.1 draft boundary.
 * Does NOT touch legacy osaka_premium_stay_v1/v2/v3 keys.
 *
 * Structural + referential preflight is a browser-safe subset of the
 * canonical JSON Schema, NOT a complete Draft 2020-12 JSON Schema validator.
 * CI validates sample data against the actual schema.
 */
import {inspectScenarioOverrides} from "./v11-field-resolver.mjs";
export const V11_DRAFT_KEY="premium_re_investment_v11";
const MAX_LENGTH=4*1024*1024;
const supportedPrefixes=Object.freeze({P:12,U:13,A:10,K:6,F:6,H:12,R:11,S:10,E:12,X:5,SC:2});
const metaTypes=new Set(["observed","sourcedEstimate","userAssumption","systemDefault","unavailable"]);
const allowedTop=new Set(["schemaVersion","assumptionsVersion","calculationVersion",
 "portfolio","entities","units","scenarios","exportedAt"]);
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const text=(x,k)=>{if(typeof x!=="string"||!x)throw new TypeError(k+" requires nonempty text");return x;};
const date=(s,k)=>{
 text(s,k);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new RangeError(k+" must be ISO date");
 const d=new Date(s+"T00:00:00Z");
 if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==s)throw new RangeError(k+" invalid date");
 return s;
};
const field=(id,value,expectedGroup)=>{
 const match=/^([A-Z]+)(\d{2})$/.exec(id);
 if(!match||!(match[1] in supportedPrefixes)||Number(match[2])<1||
    Number(match[2])>supportedPrefixes[match[1]]||
    (expectedGroup&&match[1]!==expectedGroup))
   throw new RangeError("unknown/incorrect field ID "+id);
 if(!isObj(value)||!Object.hasOwn(value,"value")||typeof value.unit!=="string"||
   !value.unit||!metaTypes.has(value.sourceType))
   throw new TypeError("field metadata invalid "+id);
 if(value.value!==null&&typeof value.value!=="string"&&
    typeof value.value!=="number"&&typeof value.value!=="boolean")
    throw new RangeError("field value unsupported "+id);
 if(typeof value.value==="number"&&!Number.isFinite(value.value))
    throw new RangeError("nonfinite field "+id);
 if(value.sourceUrl!=null&&(!String(value.sourceUrl).startsWith("https://")))
    throw new RangeError("field source URL must be HTTPS "+id);
};
function fields(record,expectedGroup=null){
 if(!isObj(record))throw new TypeError("fields object required");
 for(const [k,value] of Object.entries(record))field(k,value,expectedGroup);
}
const unitGroups=new Set(["U","A","K","F","H","R","S","X"]);
function groupedFields(groups){
 if(!isObj(groups))throw new TypeError("unit fields groups required");
 for(const [name,part] of Object.entries(groups)){
   if(!unitGroups.has(name))throw new RangeError("unsupported unit field group "+name);
   fields(part,name);
 }
}
const unique=(rows,name)=>{
 if(!Array.isArray(rows))throw new TypeError(name+" array required");
 const seen=new Set();
 for(const x of rows){
  if(!isObj(x))throw new TypeError(name+" entries must be objects");
  text(x.id,name+".id");
  if(seen.has(x.id))throw new RangeError("duplicate "+name+" ID "+x.id);
  seen.add(x.id);
 }
 return seen;
};
export function inspectV11Draft(document){
 if(!isObj(document)||document.schemaVersion!=="1.1.0")
   throw new RangeError("Only v1.1.0 saved data is supported");
 for(const key of Object.keys(document))
  if(!allowedTop.has(key))throw new RangeError("unknown top-level key "+key);
 text(document.assumptionsVersion,"assumptionsVersion");
 const p=document.portfolio;
 if(!isObj(p)||p.currency!=="JPY"||!Number.isInteger(p.holdingYears)||
    p.holdingYears<1)throw new RangeError("v1.1 portfolio JPY/horizon required");
 text(p.id,"portfolio.id");date(p.baseDate,"portfolio.baseDate");
 fields(p.fields,"P");
 const entities=unique(document.entities,"entities");
 const units=unique(document.units,"units");
 const scenarios=unique(document.scenarios,"scenarios");
 if(!entities.size||!units.size||!scenarios.size)
    throw new RangeError("A portfolio needs a tax entity, unit, and scenario");
 for(const e of document.entities){
  if(!["individual","corporation"].includes(e.taxpayerType))
   throw new RangeError("taxpayerType unsupported");
  fields(e.fields,"E");
  if(e.taxYearStartMonth!==undefined&&
     (!Number.isInteger(e.taxYearStartMonth)||e.taxYearStartMonth<1||e.taxYearStartMonth>12))
    throw new RangeError("entity fiscal-year start invalid");
 }
 for(const u of document.units){
  if(!entities.has(u.operatorEntityId)||
    (u.ownerEntityId!==null&&u.ownerEntityId!==undefined&&!entities.has(u.ownerEntityId))||
    (u.tenantEntityId!==null&&u.tenantEntityId!==undefined&&!entities.has(u.tenantEntityId)))
   throw new RangeError("unit references unknown legal entity");
  if(!["M1","M2","M3","M4"].includes(u.modelId)||
     !["own","lease"].includes(u.tenure))throw new RangeError("unsupported model / tenure");
  date(u.startDate,"unit.startDate");date(u.operationStartDate,"unit.operationStartDate");
  if(u.startDate>u.operationStartDate)throw new RangeError("unit opening precedes acquisition");
  if(!isObj(u.exit)||!["priceGrowth","NOICapitalizationReference","leaseSettlement"].includes(u.exit.method))
   throw new RangeError("unit exit missing");
  date(u.exit.exitDate,"unit.exitDate");
  if(u.exit.exitDate<u.operationStartDate)throw new RangeError("unit exits before operation");
  groupedFields(u.fields);
  if(!Array.isArray(u.calendar)||!Array.isArray(u.expenses)||!Array.isArray(u.assets)||!Array.isArray(u.loans))
   throw new TypeError("calendar, expenses, assets, loans arrays required");
  const calendarKeys=new Set();
  for(const m of u.calendar){
   if(!Number.isInteger(m.year)||!Number.isInteger(m.month)||m.month<1||m.month>12)
    throw new RangeError("calendar date invalid");
   const key=m.year+"-"+String(m.month).padStart(2,"0");
   if(calendarKeys.has(key))throw new RangeError("duplicate calendar month");
   calendarKeys.add(key);
   if(m.fields!==undefined){
    if(!isObj(m.fields))throw new TypeError("calendar field groups required");
    for(const [group,part] of Object.entries(m.fields)){
      if(!["H","R","S"].includes(group))throw new RangeError("calendar field group invalid");
      fields(part,group);
    }
   }
   const entries=["lodgingDays","rentalDays","selfUseDays","changeoverDays","idleDays"];
   let daySum=0;
   for(const name of entries){
    if(!Number.isInteger(m[name])||m[name]<0)throw new RangeError("negative or invalid "+name);
    daySum+=m[name];
   }
   const actual=new Date(Date.UTC(m.year,m.month,0)).getUTCDate();
   if(daySum!==actual)throw new RangeError("calendar allocation not equal days in "+key);
  }
  for(const [name,list] of [["expenses",u.expenses],["assets",u.assets],["loans",u.loans]]){
   const ids=new Set();
   for(const item of list){
    text(item?.id,name+".id");
    if(ids.has(item.id))throw new RangeError("duplicate "+name+" id");
    ids.add(item.id);
    const owner=item.entityId??item.ownerEntityId??item.borrowerEntityId;
    if(owner!==undefined&&!entities.has(owner))
      throw new RangeError(name+" record references unknown entity");
   }
  }
 }
 for(const scenario of document.scenarios){
  if(!Array.isArray(scenario.overrides))throw new TypeError("scenario overrides required");
  inspectScenarioOverrides({document,scenarioId:scenario.id});
 }
 return {status:"structurallyReviewed",schemaVersion:"1.1.0",
    entityCount:entities.size,unitCount:units.size,scenarioCount:scenarios.size,
    fullJsonSchemaValidated:false,
    note:"Browser preflight is not a complete JSON Schema or tax-eligibility certification"};
}
export function parseV11Draft(raw,{maxLength=MAX_LENGTH}={}){
 if(typeof raw!=="string"||raw.length>maxLength)
   throw new RangeError("v1.1 JSON missing or too large");
 let value;
 try{value=JSON.parse(raw);}catch(e){throw new SyntaxError("Invalid JSON: "+e.message);}
 const report=inspectV11Draft(value);
 return {document:structuredClone(value),report};
}
export function serializeV11Draft(document){
 inspectV11Draft(document);
 const serialized=JSON.stringify(document);
 if(serialized.length>MAX_LENGTH)throw new RangeError("v1.1 document exceeds developer storage limit");
 return serialized;
}
/** Explicit save ONLY; read-back is required to confirm. Backup old draft on
 * read-back mismatch, never modify other storage keys. */
export function saveV11Draft(storage,document){
 if(!storage||typeof storage.setItem!=="function"||typeof storage.getItem!=="function")
   throw new TypeError("Storage interface required");
 const serialized=serializeV11Draft(document);
 const previous=storage.getItem(V11_DRAFT_KEY);
 try{
   storage.setItem(V11_DRAFT_KEY,serialized);
   if(storage.getItem(V11_DRAFT_KEY)!==serialized)
     throw new Error("v1.1 storage read-back differs from serialized draft");
 }catch(error){
   try{
     if(previous!==null)storage.setItem(V11_DRAFT_KEY,previous);
     else if(typeof storage.removeItem==="function")storage.removeItem(V11_DRAFT_KEY);
   }catch{ /* browser may be out of quota; do not hide original failure */}
   throw error;
 }
 return {status:"saved",key:V11_DRAFT_KEY,length:serialized.length,
    readBackVerified:true};
}
export function restoreV11Draft(storage){
 if(!storage||typeof storage.getItem!=="function")throw new TypeError("Storage required");
 const raw=storage.getItem(V11_DRAFT_KEY);
 return raw===null?{status:"notFound",document:null}:{
  status:"restored",...parseV11Draft(raw)
 };
}
