/**
 * B-T19 mixed-use personal building disposal basis (scenario assessment).
 *
 * NTA No.2108 concrete conversion calculation:
 * https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2108_qa.htm
 * NTA No.3261 sale acquisition-cost formula:
 * https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3261.htm
 *
 * Narrow scope: one contiguous private-use period from purchase to first
 * business conversion, followed by an independently reviewed business tax
 * depreciation ledger up to sale. Reversion to private use, simultaneous
 * use, acquired improvements and inheritance need separate rules.
 *
 * Critical: disposal acquisition cost subtracts full business-period
 * depreciation equivalents, EVEN IF less was deducted on the tax return.
 * This is NOT a current-year operating expense or extra cash outlay.
 */
const NTA_CONVERSION="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2108_qa.htm";
const NTA_EXIT="https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3261.htm";
const required=(v,k)=>{if(typeof v!=="string"||!v)throw new TypeError(k+" required");return v};
const amt=(v,k,min=0,max=Infinity)=>{
 if(typeof v!=="number"||!Number.isFinite(v)||v<min||v>max)throw new RangeError(k+" invalid");
 return v;
};
const iso=(value,name)=>{
 required(value,name);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new RangeError(name+" needs YYYY-MM-DD");
 const day=new Date(value+"T00:00:00Z");
 if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==value)throw new RangeError(name+" invalid calendar date");
 return day;
};
const shifted=(date,months)=>{
 const end=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+months,1));
 const last=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+1,0)).getUTCDate();
 end.setUTCDate(Math.min(date.getUTCDate(),last));
 return end;
};
const yearDifferenceHalfUp=(start,end)=>{
 let y=end.getUTCFullYear()-start.getUTCFullYear();
 if(shifted(start,y*12)>end)y--;
 const six=shifted(start,y*12+6);
 return {wholeYears:y,roundedYears:y+(end>=six?1:0),halfYearBoundary:six.toISOString().slice(0,10)};
};
const sourceMeta=rule=>{
 if(!rule||rule.sourceUrl!==NTA_CONVERSION||!required(rule.version,"rule.version")||
 !["reviewedScenario","scenarioAssumption"].includes(rule.basis))
   throw new RangeError("NTA conversion rule provenance and applicability required");
 return {sourceUrl:rule.sourceUrl,version:rule.version,basis:rule.basis};
};
export function calculatePrivateUseReduction({
 acquiredAt,convertedAt,buildingAcquisitionCost,statutoryUsefulLifeYears,
 oldStraightLineUsefulLifeYears,oldStraightLineRate,rule
}){
 const source=sourceMeta(rule);
 const from=iso(acquiredAt,"acquiredAt"),to=iso(convertedAt,"convertedAt");
 if(from>=to)throw new RangeError("conversion date must postdate acquisition");
 const cost=amt(buildingAcquisitionCost,"buildingAcquisitionCost");
 if(!Number.isSafeInteger(cost))throw new RangeError("purchase cost requires integer yen");
 if(!Number.isInteger(statutoryUsefulLifeYears)||statutoryUsefulLifeYears<=0)
   throw new RangeError("statutory useful life required");
 const life=Math.floor(statutoryUsefulLifeYears*1.5);
 if(oldStraightLineUsefulLifeYears!==life)
   throw new RangeError("nonbusiness old-straight-line life must be 1.5× statutory life rounded down");
 const rate=amt(oldStraightLineRate,"oldStraightLineRate",Number.MIN_VALUE,1);
 const years=yearDifferenceHalfUp(from,to);
 const unreduced=cost*.9*rate*years.roundedYears;
 const privateReduction=Math.min(cost*.95,unreduced);
 return {period:{acquiredAt,convertedAt,wholeYears:years.wholeYears,
    roundedPrivateUseYears:years.roundedYears,halfYearBoundary:years.halfYearBoundary},
   oldStraightLineUsefulLifeYears:life,oldStraightLineRate:rate,
   privateReduction,atConversionBookValue:cost-privateReduction,
   privateReductionCap:cost*.95,status:"estimated",rule:source,
   note:"The reduction is for adjusted acquisition basis, not personal income-tax deductible expenses"};
}
export function calculateMixedUseIndividualSaleBasis({
 buildingId,ownerEntityId,acquiredAt,convertedAt,soldAt,
 buildingAcquisitionCost,statutoryUsefulLifeYears,
 oldStraightLineUsefulLifeYears,oldStraightLineRate,rule,
 businessDepreciationLedger,consecutiveBusinessCoverageReviewed,
 fiscalYearEndMonth,nonBusinessAfterConversion=false
}){
 required(buildingId,"buildingId");required(ownerEntityId,"ownerEntityId");
 const conversion=calculatePrivateUseReduction({acquiredAt,convertedAt,
  buildingAcquisitionCost,statutoryUsefulLifeYears,oldStraightLineUsefulLifeYears,
  oldStraightLineRate,rule});
 const sold=iso(soldAt,"soldAt");
 if(sold<=iso(convertedAt,"convertedAt"))throw new RangeError("sale must postdate business conversion");
 if(nonBusinessAfterConversion!==false)throw new RangeError("post-conversion private-only periods need another adjustment path");
 if(!Number.isInteger(fiscalYearEndMonth)||fiscalYearEndMonth<1||fiscalYearEndMonth>12)
   throw new RangeError("explicit owner fiscal-year end month required");
 const fiscalYearOf=date=>date.getUTCFullYear()+
   (date.getUTCMonth()+1>fiscalYearEndMonth?1:0);
 const firstBusinessTaxYear=fiscalYearOf(iso(convertedAt,"convertedAt"));
 const lastBusinessTaxYear=fiscalYearOf(sold);
 if(consecutiveBusinessCoverageReviewed!==true)throw new RangeError("business use periods not independently covered");
 if(!Array.isArray(businessDepreciationLedger)||!businessDepreciationLedger.length)
   throw new RangeError("business-period depreciation details required");
 const ids=new Set();let totalGross=0,totalDeductible=0;
 for(const entry of businessDepreciationLedger){
  if(!Number.isInteger(entry.taxYear)||ids.has(entry.taxYear))
    throw new RangeError("duplicate or missing business tax-year");
  ids.add(entry.taxYear);
  amt(entry.grossBookReduction,"grossBookReduction");
  amt(entry.businessDeduction,"businessDeduction");
  if(entry.businessDeduction>entry.grossBookReduction+1e-8)
    throw new RangeError("deducted depreciation cannot exceed gross reduction");
  if(entry.ownerEntityId!==ownerEntityId||
     entry.sourceAssetId!==buildingId||
     entry.reviewedForDisposalBasis!==true||
     !entry.evidenceUrl?.startsWith("https://"))
     throw new RangeError("business depreciation not evidenced for this sale");
  totalGross+=entry.grossBookReduction;
  totalDeductible+=entry.businessDeduction;
 }
 const orderedYears=[...ids].sort((a,b)=>a-b);
 if(orderedYears.length!==lastBusinessTaxYear-firstBusinessTaxYear+1||
   orderedYears[0]!==firstBusinessTaxYear||
   orderedYears[orderedYears.length-1]!==lastBusinessTaxYear)
     throw new RangeError("disposal tax basis requires every business fiscal year through sale");
 for(let i=1;i<orderedYears.length;i++)
  if(orderedYears[i]!==orderedYears[i-1]+1)
   throw new RangeError("noncontiguous business tax years");
 if(totalGross>conversion.atConversionBookValue+1e-6)
   throw new RangeError("depreciation reductions exceed adjusted purchase basis");
 const book=conversion.atConversionBookValue-totalGross;
 return {buildingId,ownerEntityId,acquiredAt,convertedAt,soldAt,
  buildingAcquisitionCost,nonBusinessReduction:conversion.privateReduction,
  businessBookReduction:totalGross,businessDeductibleExpenseHistory:totalDeductible,
  unclaimedBusinessDepreciationEquivalents:totalGross-totalDeductible,
  adjustedBuildingBasis:book,
  acquisitionCostReconciliation:buildingAcquisitionCost-conversion.privateReduction-totalGross-book,
  status:"estimated",
  sourceUrls:[NTA_CONVERSION,NTA_EXIT],
  note:"Business gross depreciation and actually deducted expense differ; neither depreciation reduction is new sale cash"};
}
