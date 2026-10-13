/**
 * v1.1 Gate C/D saved-data -> calculation field resolver.
 *
 * Priority: scenario month/unit/portfolio override, then native month/unit/
 * portfolio values, then CONDITIONAL documented defaults, then unknown.
 * A real zero is valid. null, undefined and 'unavailable' never become 0.
 * Fields are not mutated and all resolved values retain provenance.
 */
const groups=Object.freeze({P:"portfolio",U:"unit",A:"unit",K:"unit",
 F:"unit",H:"unitOrMonth",R:"unitOrMonth",S:"unitOrMonth",
 E:"entity",X:"unit",SC:"scenario"});
const unitGroup=new Set(["U","A","K","F","H","R","S","X"]);
const monthGroup=new Set(["H","R","S"]);
const types=new Set(["observed","sourcedEstimate","userAssumption","systemDefault","unavailable"]);
const defaultValues=Object.freeze({
 P05:{value:1,unit:"percent",sourceType:"systemDefault"},
 P06:{value:2,unit:"percent",sourceType:"systemDefault"},
 P07:{value:60,unit:"percent",sourceType:"systemDefault"},
 P09:{value:0,unit:"percent",sourceType:"systemDefault"},
 P08:{value:6,unit:"months",sourceType:"systemDefault"},
 H05:{value:1,unit:"multiplier",sourceType:"systemDefault"},
 H06:{value:1,unit:"multiplier",sourceType:"systemDefault"}
});
const nonempty=(s,k)=>{if(typeof s!=="string"||!s)throw new TypeError(k+" required");return s;};
function fieldGroup(fieldId){
 nonempty(fieldId,"fieldId");
 if(!/^(P|U|A|K|F|H|R|S|E|X|SC)\d{2}$/.test(fieldId))throw new RangeError("invalid field ID "+fieldId);
 return fieldId.replace(/\d+$/,"");
}
function metadata(value,fieldId){
 if(!value||typeof value!=="object"||Array.isArray(value)||
    typeof value.unit!=="string"||!types.has(value.sourceType)||
    !("value" in value))
    throw new TypeError("invalid field metadata: "+fieldId);
 const status=value.value===null||value.sourceType==="unavailable"?"incomplete":"available";
 if(status==="available"&&(typeof value.value==="number"&&!Number.isFinite(value.value)))
   throw new RangeError("nonfinite field "+fieldId);
 return {status,value:value.value,fieldId,unit:value.unit,sourceType:value.sourceType,
   sourceUrl:value.sourceUrl??null,asOfDate:value.asOfDate??null,isOverride:value.isOverride===true};
}
function location(group,portfolio,entity,unit,month){
 if(group==="P")return portfolio?.fields?.P??{};
 if(group==="E")return entity?.fields?.E??{};
 if(unitGroup.has(group)){
  if(monthGroup.has(group)&&month?.fields?.[group])return month.fields[group];
  return unit?.fields?.[group]??{};
 }
 return {};
}
export function inspectScenarioOverrides({document,scenarioId}){
 if(document?.schemaVersion!=="1.1.0"||
   !Array.isArray(document.scenarios)||!Array.isArray(document.units)||
   !Array.isArray(document.entities))throw new TypeError("v1.1 document arrays required");
 const scenario=document.scenarios.find(x=>x.id===scenarioId);
 if(!scenario||!Array.isArray(scenario.overrides))throw new RangeError("scenario not found");
 const keys=new Set(),knownUnit=new Set(document.units.map(x=>x.id));
 const knownEntity=new Set(document.entities.map(x=>x.id));
 const overrides=new Map();
 for(const o of scenario.overrides){
   const group=fieldGroup(o.fieldId);
   const validScope=(o.scope==="portfolio"&&group==="P"&&o.targetId===document.portfolio?.id)||
      (o.scope==="entity"&&group==="E"&&knownEntity.has(o.targetId))||
      (o.scope==="unit"&&unitGroup.has(group)&&knownUnit.has(o.targetId))||
      (o.scope==="month"&&monthGroup.has(group)&&knownUnit.has(o.targetId)&&
        Number.isInteger(o.year)&&Number.isInteger(o.month)&&o.month>=1&&o.month<=12);
   if(!validScope)throw new RangeError("invalid or unsupported scenario override target: "+o.fieldId);
   const key=[o.scope,o.targetId,o.year??"",o.month??"",o.fieldId].join("|");
   if(keys.has(key))throw new RangeError("duplicate scenario override "+key);
   keys.add(key);
   overrides.set(key,metadata(o.field,o.fieldId));
 }
 return {scenarioId,overrides};
}
/**
 * The field ID determines the allowed scope. Month context is a YYYY/MM pair.
 * For H/R/S, a missing month-specific field does NOT shadow unit-wide field.
 */
export function resolveV11Field({
 document,scenarioContext,fieldId,unitId=null,entityId=null,year=null,month=null
}){
 const group=fieldGroup(fieldId);
 if(group==="SC")throw new RangeError("SC scenario metadata not a numeric engine input");
 const portfolio=document?.portfolio;
 if(!portfolio||!scenarioContext?.overrides)throw new TypeError("document and scenario resolver required");
 const unit=unitId===null?null:document.units.find(x=>x.id===unitId);
 const entity=entityId===null?null:document.entities.find(x=>x.id===entityId);
 if(unitId!==null&&!unit)throw new RangeError("unknown unit "+unitId);
 if(entityId!==null&&!entity)throw new RangeError("unknown entity "+entityId);
 if(group!=="P"&&group!=="E"&&!unit)throw new RangeError("unit context required for "+fieldId);
 if(group==="E"&&!entity)throw new RangeError("entity context required");
 let monthRecord=null;
 if(year!==null||month!==null){
  if(!Number.isInteger(year)||!Number.isInteger(month)||month<1||month>12)
    throw new RangeError("month context requires year and month");
  monthRecord=unit?.calendar?.find(x=>x.year===year&&x.month===month)??null;
 }
 const lookup=(scope,targetId,yr="",mo="")=>scenarioContext.overrides.get([scope,targetId,yr,mo,fieldId].join("|"))??null;
 let winner=null,origin="missing";
 if(group==="P"){winner=lookup("portfolio",portfolio.id);origin="scenarioPortfolio";}
 else if(group==="E"){winner=lookup("entity",entity.id);origin="scenarioEntity";}
 else{
   if(monthGroup.has(group)&&year!==null){winner=lookup("month",unit.id,year,month);origin="scenarioMonth";}
   if(!winner){winner=lookup("unit",unit.id);origin="scenarioUnit";}
 }
 if(!winner){
   const field=monthGroup.has(group)?monthRecord?.fields?.[group]?.[fieldId]:undefined;
   if(field!==undefined){winner=metadata(field,fieldId);origin="monthField";}
 }
 if(!winner){
   const field=location(group,portfolio,entity,unit,null)?.[fieldId];
   if(field!==undefined){winner=metadata(field,fieldId);origin="entityUnitOrPortfolio";}
 }
 if(!winner&&defaultValues[fieldId]){
   winner=metadata(defaultValues[fieldId],fieldId);origin="documentedDefault";
 }
 if(!winner)return {status:"incomplete",value:null,fieldId,origin:"missing",reason:"Field not provided"};
 return {...winner,origin};
}
export function requireResolvedNumber(result,{min=-Infinity,max=Infinity,integer=false}={}){
 if(result?.status!=="available"||typeof result.value!=="number"||!Number.isFinite(result.value))
   return {status:"incomplete",fieldId:result?.fieldId??null,
     reason:"Required numeric field is missing or not numeric"};
 if(result.value<min||result.value>max||(integer&&!Number.isInteger(result.value)))
   throw new RangeError(result.fieldId+" outside permitted numeric range");
 return {...result,status:"available"};
}
export function numericPercent(result){
 const v=requireResolvedNumber(result,{min:0,max:100});
 return v.status==="available"?{...v,value:v.value/100,unit:"decimal"}:v;
}
export const v11ResolverDefaults=defaultValues;
