/**
 * Explicit scenario tax-rule bundles and per-asset annual depreciation.
 * This is a configuration validator, not a tax-law eligibility oracle.
 * No statutory method or rate is inferred from a property label.
 */
const finite=(v,k,min=-Infinity,max=Infinity)=>{
  if(typeof v!=="number"||!Number.isFinite(v)||v<min||v>max)
    throw new RangeError(k+" must be a finite number within specified limits");
  return v;
};
const date=(v,k)=>{
  if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+"T00:00:00Z")))
    throw new RangeError(k+" requires ISO date");
  const d=new Date(v+"T00:00:00Z");
  if(d.toISOString().slice(0,10)!==v)throw new RangeError(k+" invalid calendar date");
  return v;
};
const ratios=v=>finite(v,"ratio",0,1);
const quarter=(v,k)=>{if(!Number.isInteger(v)||v<0||v>12)throw new RangeError(k+" must be 0..12");return v;};
const plusYear=(ymd,n)=>{const y=Number(ymd.slice(0,4))+n;return String(y)+ymd.slice(4);};
export function verifyTaxRuleBundle({rules,periodStart,taxpayerType,requiredTaxKinds}){
  date(periodStart,"periodStart");
  if(!["individual","corporation"].includes(taxpayerType))throw new RangeError("taxpayerType");
  if(!Array.isArray(rules)||!Array.isArray(requiredTaxKinds))throw new TypeError("rule arrays required");
  const matched=new Map();
  for(const r of rules){
    if(!r||typeof r.kind!=="string"||!r.kind||typeof r.version!=="string"||!r.version)
      throw new TypeError("typed tax rule kind/version required");
    date(r.validFrom,"validFrom");date(r.validUntil,"validUntil");
    if(r.validFrom>r.validUntil)throw new RangeError("rule dates inverted");
    if(typeof r.sourceUrl!=="string"||!r.sourceUrl.startsWith("https://"))throw new RangeError("rule source URL required");
    if(!["confirmed","scenarioAssumption"].includes(r.basis))throw new RangeError("rule basis");
    if(!r.eligibilityConfirmed&&r.basis==="confirmed")throw new RangeError("claimed confirmed rule eligibility unproven");
    if(r.taxpayerType!==taxpayerType&&r.taxpayerType!=="both")continue;
    if(r.validFrom<=periodStart&&periodStart<=r.validUntil){
      if(matched.has(r.kind))throw new RangeError("overlapping tax rule for "+r.kind);
      matched.set(r.kind,r);
    }
  }
  const missing=[...new Set(requiredTaxKinds)].filter(x=>!matched.has(x));
  return {status:missing.length?"incomplete":([...matched.values()].some(x=>x.basis==="scenarioAssumption")?"estimated":"computed"),
    missingTaxKinds:missing,
    rules:Object.fromEntries([...matched.entries()].map(([k,v])=>[k,{version:v.version,basis:v.basis,sourceUrl:v.sourceUrl,validFrom:v.validFrom,validUntil:v.validUntil}])),
    periodStart,taxpayerType};
}

/**
 * Explicit historical business ratios and book-value reduction.
 * This does NOT infer historical personal-use disposal basis.
 * Calculated gross reduction is noncash and cannot appear as CapEx again.
 */
export function depreciateAssetTimeline({
  id,category,openingBookValue,acquisitionBasis,annualRate,method,
  years,minimumResidualValue=0
}){
  if(typeof id!=="string"||!id)throw new TypeError("asset id");
  if(!["land","building","buildingEquipment","leaseholdImprovement","furniture","appliance","other"].includes(category))
    throw new RangeError("unsupported asset type");
  finite(openingBookValue,"openingBookValue",0);
  finite(acquisitionBasis,"acquisitionBasis",0);
  finite(minimumResidualValue,"minimumResidualValue",0);
  if(openingBookValue<minimumResidualValue)throw new RangeError("minimum value exceeds book");
  if(!Array.isArray(years)||!years.length)throw new TypeError("years required");
  if(category==="land" && method!=="nonDepreciable")throw new RangeError("land cannot be depreciated");
  if(category!=="land"&&method!=="straightLine"&&method!=="nonDepreciable")
    throw new RangeError("unsupported asset method (manual statutory schedule needed)");
  if(method==="straightLine")ratios(annualRate);
  let book=openingBookValue,previous=-Infinity;
  const rows=[];
  for(const y of years){
    if(!Number.isInteger(y.taxYear)||y.taxYear<=previous)throw new RangeError("years must increase");
    previous=y.taxYear;
    quarter(y.inServiceMonths,"inServiceMonths");
    const share=ratios(y.businessUseRatio);
    if(typeof y.sourceUrl!=="string"||!y.sourceUrl.startsWith("https://"))throw new RangeError("asset rule source required");
    if(!["scenarioAssumption","confirmed"].includes(y.ruleBasis))throw new RangeError("asset rule basis");
    const capacity=Math.max(0,book-minimumResidualValue);
    const grossReduction=method==="straightLine"?Math.min(capacity,acquisitionBasis*annualRate*y.inServiceMonths/12):0;
    // Business expense recognized differs from physical-book-value reduction when own use occurs.
    const deductibleDepreciation=grossReduction*share;
    const nextBook=book-grossReduction;
    rows.push({taxYear:y.taxYear,openingBookValue:book,grossBookReduction:grossReduction,
      deductibleDepreciation,privateUseReduction:grossReduction-deductibleDepreciation,
      closingBookValue:nextBook,ruleBasis:y.ruleBasis,ruleSourceUrl:y.sourceUrl});
    book=nextBook;
  }
  return {assetId:id,category,rows,closingBookValue:book,status:years.some(x=>x.ruleBasis==="scenarioAssumption")?"estimated":"computed",
    note:"Historical private-use adjusted disposal basis must be separately verified"};
}
