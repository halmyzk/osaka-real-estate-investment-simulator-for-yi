/**
 * Gate B: rounding policies are explicit model parameters per tax year/kind.
 * This module does NOT assert which rule is legally applicable in a year.
 * All values are non-negative tax amounts or signed adjustments configured
 * by a documented rule; no implicit floating-point yen rounding.
 */
const num=(x,k)=>{if(typeof x!=="number"||!Number.isFinite(x))throw new TypeError(k+" finite number required");return x};
const names=new Set(["floor","ceil","nearest","truncate"]);
export function applyStatutoryRounding({value,increment,method,signed=false}){
 num(value,"value");num(increment,"increment");
 if(increment<=0||!Number.isInteger(increment))throw new RangeError("positive integer increment required");
 if(!names.has(method))throw new RangeError("rounding method must be explicit");
 if(!signed&&value<0)throw new RangeError("negative amount requires signed mode");
 const v=value/increment;
 let q;
 if(method==="floor")q=Math.floor(v);
 else if(method==="ceil")q=Math.ceil(v);
 else if(method==="nearest")q=Math.round(v);
 else q=Math.trunc(v);
 return q*increment;
}
/**
 * Valid dates and source URL are recorded; unknown matching rule => incomplete.
 * Each kind and stage must match exactly one rule for the applicable year.
 */
export function roundTaxStage({value,taxYear,taxKind,stage,rules}){
 num(value,"value");
 if(!Number.isInteger(taxYear)||taxYear<1900)throw new RangeError("taxYear");
 if(typeof taxKind!=="string"||!taxKind||typeof stage!=="string"||!stage)throw new TypeError("tax kind/stage required");
 if(!Array.isArray(rules))throw new TypeError("rules array required");
 const matched=rules.filter(x=>x.taxYear===taxYear&&x.taxKind===taxKind&&x.stage===stage);
 if(matched.length===0)return {status:"incomplete",value:null,reason:"Rounding policy missing for tax year/kind/stage"};
 if(matched.length!==1)throw new RangeError("duplicate applicable rounding rules");
 const rule=matched[0];
 if(typeof rule.sourceUrl!=="string"||!rule.sourceUrl.startsWith("https://"))throw new TypeError("rule source URL");
 if(!["confirmed","scenarioAssumption"].includes(rule.basis))throw new RangeError("rule basis required");
 return {status:rule.basis==="confirmed"?"computed":"estimated",
   value:applyStatutoryRounding({value,increment:rule.increment,method:rule.method,signed:rule.signed===true}),
   taxYear,taxKind,stage,ruleVersion:rule.version,ruleSourceUrl:rule.sourceUrl};
}
