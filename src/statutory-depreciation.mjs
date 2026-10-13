/**
 * Gate B B-T08/09/10/22 — evidence-based annual tax depreciation examples.
 * NTA (as of 2026-04-01): https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/5410.htm
 * NTA method restrictions: https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2105.htm
 *
 * Supports Japanese straight-line and post-2007 declining-balance
 * (including guarantee/revised-basis switch) with explicit published rates.
 * It DOES NOT infer a legal useful life, default taxpayer elections,
 * historical personal-use disposal basis or year-specific eligibility.
 */
const val=(x,k,min=0,max=Infinity)=>{if(typeof x!=="number"||!Number.isFinite(x)||x<min||x>max)throw new RangeError(k+" must be finite and within range");return x;};
const date=(s,k)=>{if(typeof s!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new RangeError(k+" must be ISO date");const d=new Date(s+"T00:00:00Z");if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)throw new RangeError(k+" invalid calendar date");return s;};
const ident=(s,k)=>{if(typeof s!=="string"||!s)throw new TypeError(k+" must be non-empty string");return s;};
const floorYen=x=>Math.floor(x+1e-9);
const isTaxCategory=new Set(["corporate","business","realEstate","miscellaneous"]);
export function calculateStatutoryAssetSchedule({asset,methodRule,years}){
 if(!asset||!methodRule||!Array.isArray(years)||!years.length)throw new TypeError("asset, method rule and years required");
 for(const k of ["assetId","ownerEntityId","unitId"])ident(asset[k],k);
 const acquired=date(asset.acquisitionDate,"acquisitionDate"),service=date(asset.inServiceDate,"inServiceDate");
 if(service<acquired)throw new RangeError("service predates acquisition");
 if(acquired<"2007-04-01")throw new RangeError("Pre-2007 acquisition requires legacy methods");
 const category=asset.category,method=asset.method;
 if(!["land","building","buildingEquipment","leaseholdImprovement","furniture","appliance","other"].includes(category))
  throw new RangeError("unsupported asset category");
 if(!["nonDepreciable","straightLine","decliningBalance"].includes(method))throw new RangeError("unsupported method");
 if(category==="land" && method!=="nonDepreciable")throw new RangeError("land non-depreciable");
 if(category!=="land"&&method==="nonDepreciable")throw new RangeError("non-land asset requires reviewed non-depreciable reason");
 if(method==="decliningBalance" && (category==="building" || (category==="buildingEquipment"&&acquired>="2016-04-01")))
  throw new RangeError("declining-balance method prohibited for acquisition/category");
 const basis=val(asset.acquisitionBasis,"acquisitionBasis");
 if(!Number.isSafeInteger(basis))throw new RangeError("yen acquisition basis must be safe integer");
 if(!isTaxCategory.has(asset.taxCategory))throw new RangeError("tax category required");
 const minBook=method==="nonDepreciable"?basis:(basis>0?1:0);
 if(!methodRule.sourceUrl?.startsWith("https://www.nta.go.jp/")||
    methodRule.method!==method||methodRule.assetCategory!==category||
    typeof methodRule.version!=="string"||!methodRule.version||
    methodRule.validFrom===undefined||methodRule.validUntil===undefined)
   throw new RangeError("versioned NTA method rule required");
 const from=date(methodRule.validFrom,"validFrom"),until=date(methodRule.validUntil,"validUntil");
 if(from>acquired||until<acquired)throw new RangeError("rule does not cover acquisition date");
 if(!["reviewedScenario","scenarioAssumption"].includes(methodRule.eligibility))
   throw new RangeError("explicit method eligibility required");
 if(method!=="nonDepreciable"){
  val(methodRule.annualRate,"annualRate",Number.MIN_VALUE,1);
  if(!Number.isInteger(asset.usefulLifeYears)||asset.usefulLifeYears<1)throw new RangeError("useful life required");
 }
 if(method==="decliningBalance"){
  val(methodRule.guaranteeRate,"guaranteeRate",Number.MIN_VALUE,1);
  val(methodRule.revisedAnnualRate,"revisedAnnualRate",Number.MIN_VALUE,1);
 }
 let previousYear=0,book=basis, revisedBasis=null;
 const lines=[];
 for(const y of years){
  if(!Number.isInteger(y.taxYear)||y.taxYear<Number(service.slice(0,4))||
     (previousYear && y.taxYear!==previousYear+1))throw new RangeError("continuous service-year records required");
  previousYear=y.taxYear;
  if(!Number.isInteger(y.inServiceMonths)||y.inServiceMonths<0||y.inServiceMonths>12)
    throw new RangeError("in-service months 0..12 required");
  const businessShare=val(y.businessUseShare,"businessUseShare",0,1);
  if(typeof y.allocationEvidenceUrl!=="string"||!y.allocationEvidenceUrl.startsWith("https://"))
    throw new RangeError("business share evidence required");
  const openingBookValue=book;
  let depreciation=0,calculationMethod=method;
  if(method==="straightLine"){
    depreciation=floorYen(basis*methodRule.annualRate*y.inServiceMonths/12);
  }else if(method==="decliningBalance"){
    const prelim=floorYen(book*methodRule.annualRate*y.inServiceMonths/12);
    const guaranteed=basis*methodRule.guaranteeRate;
    if(revisedBasis===null && y.inServiceMonths>0 && prelim<guaranteed*y.inServiceMonths/12)
      revisedBasis=book;
    if(revisedBasis!==null){
      calculationMethod="decliningBalanceRevised";
      depreciation=floorYen(revisedBasis*methodRule.revisedAnnualRate*y.inServiceMonths/12);
    }else depreciation=prelim;
  }
  depreciation=Math.min(Math.max(0,book-minBook),depreciation);
  book-=depreciation;
  const businessDeduction=depreciation*businessShare;
  lines.push({taxYear:y.taxYear,assetId:asset.assetId,ownerEntityId:asset.ownerEntityId,
   taxCategory:asset.taxCategory,openingBookValue,grossBookReduction:depreciation,
   businessUseShare:businessShare,businessDeduction,privateUseAllocation:depreciation-businessDeduction,
   closingBookValue:book,calculationMethod,rateRuleVersion:methodRule.version,
   sourceUrl:methodRule.sourceUrl,allocationEvidenceUrl:y.allocationEvidenceUrl});
 }
 return {assetId:asset.assetId,ownerEntityId:asset.ownerEntityId,unitId:asset.unitId,
  category,method,acquisitionBasis:basis,closingBookValue:book,lines,
  status:"estimated",sourceUrl:methodRule.sourceUrl,
  note:"Scenario deduction uses a business-use fraction; personal non-business disposal basis is not determined here. Depreciation is NONCASH."};
}
export function depreciationTaxItems({assetSchedules,taxYear}){
 if(!Array.isArray(assetSchedules)||!Number.isInteger(taxYear))throw new TypeError("asset schedules and tax year required");
 const ids=new Set(),items=[];
 for(const x of assetSchedules){
  if(!x||!x.assetId||ids.has(x.assetId)||!Array.isArray(x.lines)||x.status==="incomplete")
    throw new RangeError("asset schedule invalid/duplicate");
  ids.add(x.assetId);
  const rows=x.lines.filter(y=>y.taxYear===taxYear);
  if(rows.length!==1)throw new RangeError("asset tax year missing/duplicated");
  const r=rows[0];
  val(r.businessDeduction,"businessDeduction");
  items.push({entityId:r.ownerEntityId,taxYear,category:r.taxCategory,
   kind:"depreciation",amount:r.businessDeduction,sourceAssetId:x.assetId,noncash:true});
 }
 return items;
}
