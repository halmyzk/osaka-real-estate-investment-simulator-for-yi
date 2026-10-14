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

/**
 * Modify/delete one explicitly quick-created cash line. Manual lines and
 * land/building tax basis must never be mutated by the quick editor.
 * Returning a clone permits a UI confirmation before any draft change.
 */
export function editV11QuickLine({document,unitId,lineId,newAmount}){
 amount(newAmount,"newAmount");
 const copy=structuredClone(document),unit=locate(copy,unitId);
 const expense=(unit.expenses??[]).find(e=>e.id===lineId);
 if(expense){
  if(!expense.id.startsWith("quick-")||!expense.description?.startsWith("[quick:"))
    throw new RangeError("Only uniquely marked quick expenses can be edited");
  expense.amount=newAmount;
  return {document:copy,lineId,lineKind:"expense",newAmount};
 }
 const asset=(unit.assets??[]).find(a=>a.id===lineId);
 if(!asset||!asset.id.startsWith("quick-renovation-"))
  throw new RangeError("Unknown or protected manual/real-estate line");
 if(newAmount<=0)throw new RangeError("Renovation amount must be positive; delete the line to remove it");
 if(!["buildingEquipment","leaseholdImprovement"].includes(asset.category))
  throw new RangeError("Cannot edit non-renovation asset category");
 asset.grossCost=newAmount;
 asset.taxBasis=newAmount;
 asset.taxBookValue=newAmount;
 if(asset.source?.sourceType==="userAssumption")asset.source.value=newAmount;
 recomputeQuickCapExTotal(unit);
 return {document:copy,lineId,lineKind:"capex",newAmount,
  warning:"Gross renovation cash updated; indicative depreciation and its VAT credit are not automatically deducted"};
}
export function removeV11QuickLine({document,unitId,lineId}){
 const copy=structuredClone(document),unit=locate(copy,unitId);
 const expense=(unit.expenses??[]).find(e=>e.id===lineId);
 if(expense){
  if(!expense.id.startsWith("quick-")||!expense.description?.startsWith("[quick:"))
    throw new RangeError("Only explicitly marked quick expense may be deleted");
  unit.expenses=unit.expenses.filter(x=>x.id!==lineId);
  return {document:copy,lineId,lineKind:"expense",deletedAmount:expense.amount};
 }
 const asset=(unit.assets??[]).find(a=>a.id===lineId);
 if(!asset||!asset.id.startsWith("quick-renovation-")||
    !["buildingEquipment","leaseholdImprovement"].includes(asset.category))
  throw new RangeError("Cannot delete unknown or protected non-quick asset");
 unit.assets=unit.assets.filter(x=>x.id!==lineId);
 recomputeQuickCapExTotal(unit);
 return {document:copy,lineId,lineKind:"capex",deletedAmount:asset.grossCost};
}
function recomputeQuickCapExTotal(unit){
 const total=(unit.assets??[]).filter(a=>a.category!=="land"&&a.category!=="building")
   .reduce((sum,a)=>sum+amount(a.grossCost,"non-property asset cost"),0);
 unit.fields.K??={};
 unit.fields.K.K01={value:total,unit:"JPY",sourceType:"userAssumption"};
}
const monthFor=e=>e.periodStart?.slice(0,7);
const identical=(a,b)=>Math.abs(a-b)<=Math.max(1e-6,Math.abs(a)*1e-10);
/**
 * Reviewable warnings (not silent deletion). Values with similar names may
 * be genuinely separate invoices, so do not guess which cash is correct.
 * Duplicate expense IDs are a hard error even in manually authored data.
 */
export function inspectV11QuickInputConflicts({document,unitId}){
 const unit=locate(document,unitId),expenses=unit.expenses??[];
 const flags=[],ids=new Set();
 const add=(code,message,lineIds=[],fieldId=null)=>flags.push({
  code,severity:"review",unitId,message,lineIds,fieldId
 });
 for(const e of expenses){
  if(ids.has(e.id))throw new RangeError("Duplicate expense ID: "+e.id);
  ids.add(e.id);
 }
 for(const e of expenses){
  if(!e.description?.startsWith("[quick:"))continue;
  const mo=monthFor(e);
  const same=expenses.filter(x=>x.id!==e.id&&
     monthFor(x)===mo&&x.category===e.category&&
     identical(x.amount,e.amount));
  for(const other of same){
   // Only one marker row per pair. A manual ID is also reported.
   if(e.id.localeCompare(other.id)<0||!other.description?.startsWith("[quick:"))
     add("sameAmountCategoryMonth","同じ月・分類・同額の経費が重複している可能性。請求書の別取引か確認",
       [e.id,other.id]);
  }
  if(e.category==="propertyOperating"){
   const fixed=unit.fields?.A?.A05?.value;
   if(typeof fixed==="number"&&fixed>0)
      add("propertyRecurringOverlap","A05の月次保有費とクイック費用が同じ支出を含む可能性",
        [e.id],"A05");
  }
  if(e.category==="lodgingOperating"){
   const fixedNames=["H10","H12"];
   for(const fieldId of fixedNames){
    const fixed=unit.fields?.H?.[fieldId]?.value;
    if(typeof fixed==="number"&&fixed>0&&
       identical(fixed,e.amount))
      add("lodgingFixedOverlap","H10/H12の固定費と月次入力の同額重複を確認",
         [e.id],fieldId);
   }
  }
  if(e.category==="rentalOperating"){
   for(const fieldId of ["R05","R08"]){
    const value=unit.fields?.R?.[fieldId]?.value;
    if(typeof value==="number"&&value>0&&identical(value,e.amount))
      add("rentalFixedOverlap","R05/R08の賃貸運営費との同額重複を確認",
         [e.id],fieldId);
   }
  }
 }
 const ota=unit.fields?.H?.H08?.value;
 if(typeof ota==="number"&&ota>0){
  for(const e of expenses){
   if(e.category==="lodgingOperating"&&
      /OTA|booking|airbnb|予約サイト|プラットフォーム|販売手数料|commission/i.test(e.description??""))
      add("otaCommissionOverlap","H08のOTA料率と、手入力済みのOTA相当手数料が重複している可能性",
        [e.id],"H08");
  }
 }
 const initial=unit.fields?.K?.K01?.value;
 const otherAssets=(unit.assets??[]).filter(a=>a.category!=="land"&&a.category!=="building");
 const sum=otherAssets.reduce((a,b)=>a+amount(b.grossCost,"asset cost"),0);
 if(typeof initial==="number"&&initial>0&&!identical(initial,sum))
  add("capitalTotalMismatch","K01と明細資産の合計が不一致。設備投資の重複または未登録の可能性",[],"K01");
 return {status:flags.length?"review":"clear",flags,
   scannedExpenses:expenses.length,scannedAssets:unit.assets?.length??0};
}
