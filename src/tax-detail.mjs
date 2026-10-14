/**
 * Gate B advanced guarded tax calculations. These calculators deliberately
 * require explicit eligibility and legal-year rule configuration.
 * Figures are assessment inputs, NOT an automatic filing determination.
 */
const n=(v,k,min=-Infinity,max=Infinity)=>{
 if(typeof v!=="number"||!Number.isFinite(v)||v<min||v>max)throw new RangeError(k+": invalid numeric value");
 return v;
};
const proportion=(v,k)=>n(v,k,0,1);
const sum=xs=>xs.reduce((s,x)=>s+x,0);
const taxYear=y=>{if(!Number.isInteger(y)||y<1900||y>2200)throw new RangeError("invalid taxYear");return y;};

/** FIFO old-vintage-first corporate carryforward, no implied loss refunds. */
export function corporateLossCarryforward({
 taxYear:year,profitBeforeCarryforward,openingLosses,eligible,
 maxOffsetFraction,allowNewLossCarryforward,ruleSourceUrl
}){
 taxYear(year);n(profitBeforeCarryforward,"profitBeforeCarryforward");
 if(typeof eligible!=="boolean"||typeof allowNewLossCarryforward!=="boolean")throw new TypeError("eligibility explicit");
 if(typeof ruleSourceUrl!=="string"||!/^https:\/\//.test(ruleSourceUrl))throw new TypeError("official/source URL required");
 proportion(maxOffsetFraction,"maxOffsetFraction");
 if(!Array.isArray(openingLosses))throw new TypeError("openingLosses");
 const seen=new Set();
 const rows=openingLosses.map(x=>{
  if(!x||typeof x.id!=="string"||!x.id||seen.has(x.id))throw new RangeError("vintage ID invalid/duplicate");
  seen.add(x.id); taxYear(x.originYear); taxYear(x.expirationYear);
  if(x.originYear>=year||x.expirationYear<x.originYear)throw new RangeError("vintage dates invalid");
  return {...x,remainingAmount:n(x.remainingAmount,"remainingAmount",0),used:0,
    expired:x.expirationYear<year};
 }).sort((a,b)=>a.originYear-b.originYear||a.id.localeCompare(b.id));
 let positiveIncome=Math.max(0,profitBeforeCarryforward);
 let permitted=eligible?positiveIncome*maxOffsetFraction:0;
 for(const x of rows){
   if(x.expired)continue;
   x.used=Math.min(permitted,x.remainingAmount);permitted-=x.used;
   x.remainingAmount-=x.used;
 }
 const used=sum(rows.map(x=>x.used));
 const taxableIncome=Math.max(0,profitBeforeCarryforward-used);
 const newLoss=Math.max(0,-profitBeforeCarryforward);
 const newLossAdded=allowNewLossCarryforward&&eligible?newLoss:0;
 const closing=rows.filter(x=>!x.expired&&x.remainingAmount>0).map(x=>({
  id:x.id,originYear:x.originYear,expirationYear:x.expirationYear,remainingAmount:x.remainingAmount
 }));
 if(newLossAdded>0)closing.push({id:"new-loss-"+year,originYear:year,expirationYear:year+10,
  remainingAmount:newLossAdded,eligibilityRequiresReview:true});
 return {taxYear:year,taxableIncome,usedLoss:used,expiredLoss:sum(rows.filter(x=>x.expired).map(x=>x.remainingAmount)),
  newLoss,newLossAdded,closingLosses:closing,status:"estimated",
  sourceUrl:ruleSourceUrl,
  note:"Applicable loss vintage period, corporate status, blue-return continuity and deduction limit must be externally confirmed"};
}

/** Individual separate taxation of land/building gain, only after basis checks. */
export function individualSaleGainTax({
 taxYear:year,taxableGain,holdingClass,eligibleReliefConfirmed=false,
 specialDeduction=0, nationalRateLong=.15,nationalRateShort=.30,
 residenceRateLong=.05,residenceRateShort=.09,
 reconstructionRate,defenseIncomeRate,ruleSourceUrl
}){
 taxYear(year);
 n(taxableGain,"taxableGain",0);n(specialDeduction,"specialDeduction",0);
 if(!["long","short"].includes(holdingClass))throw new RangeError("holding class");
 if(specialDeduction>0&&!eligibleReliefConfirmed)throw new RangeError("special relief not established");
 for(const [key,val] of Object.entries({nationalRateLong,nationalRateShort,residenceRateLong,residenceRateShort,reconstructionRate,defenseIncomeRate}))
   proportion(val,key);
 if(typeof ruleSourceUrl!=="string"||!ruleSourceUrl.startsWith("https://"))throw new TypeError("rule source required");
 const netTaxableGain=Math.max(0,taxableGain-specialDeduction);
 const nationalBase=netTaxableGain*(holdingClass==="long"?nationalRateLong:nationalRateShort);
 const local=netTaxableGain*(holdingClass==="long"?residenceRateLong:residenceRateShort);
 const reconstruction=nationalBase*reconstructionRate;
 const defense=nationalBase*defenseIncomeRate;
 return {year,holdingClass,taxableGainAfterRelief:netTaxableGain,nationalBaseTax:nationalBase,
  reconstructionTax:reconstruction,defenseIncomeTax:defense,localResidenceTax:local,
  totalTaxBeforeRounding:nationalBase+reconstruction+defense+local,
  status:"estimated",sourceUrl:ruleSourceUrl,
  note:"Unrounded estimate; separate rounding, acquisition basis and payment due dates require explicit tax-year rules"};
}

/**
 * Local corporate statutory groups differ by municipality, capital and
 * business-year rules. All components must be supplied, not hardcoded to 0%.
 * Denominator and classification are user-provided annual tax bases.
 */
export function configuredCorporateLocalTaxes({
 taxYear:year,taxBase,corporateNationalBaseTax,
 legalEntityCount,components,ruleSourceUrl
}){
 taxYear(year);n(taxBase,"taxBase",0);n(corporateNationalBaseTax,"corporateNationalBaseTax",0);
 if(!Number.isInteger(legalEntityCount)||legalEntityCount<1)throw new RangeError("legalEntityCount invalid");
 if(typeof ruleSourceUrl!=="string"||!ruleSourceUrl.startsWith("https://"))throw new TypeError("local tax rule source required");
 if(!Array.isArray(components)||components.length===0)throw new TypeError("local corporate components cannot be empty");
 const seen=new Set();
 const breakdown=components.map(c=>{
  if(!c||typeof c.kind!=="string"||seen.has(c.kind))throw new RangeError("component kind duplicated");
  if(!["corporateResidenceIncomeLevy","corporateResidencePerCapita",
     "corporateBusinessIncomeLevy","specialCorporateBusiness","localCorporateNational",
     "externalStandardLevy","other"].includes(c.kind))throw new RangeError("unsupported local component");
  seen.add(c.kind);
  if(!["taxableIncome","nationalCorporateTax","fixedAmount"].includes(c.basis))throw new RangeError("component basis");
  let value;
  if(c.basis==="fixedAmount"){value=n(c.fixedAmount,"fixedAmount",0)*legalEntityCount;}
  else{
   proportion(c.rate,"local corporate rate");
   value=(c.basis==="taxableIncome"?taxBase:corporateNationalBaseTax)*c.rate;
  }
  return {kind:c.kind,basis:c.basis,amount:value};
 });
 return {taxYear:year,breakdown,total:sum(breakdown.map(x=>x.amount)),status:"estimated",
  sourceUrl:ruleSourceUrl,note:"Every local component and legal eligibility must be verified for each location and fiscal year"};
}
/**
 * VAT output classification and input-credit allocation, with explicit
 * taxpayer status and VAT-included receipts reconciliation.
 * Residential rental exempt; accommodation taxable unless separately proven.
 */
export function classifiedConsumptionVAT({
 status,method,transactions,creditMethod="itemized",taxableSalesRatio=null,
  hasFullCreditEligibility=false,confirmedRefundEligibility=false,
  deemedInputRate=null
}){
 if(!["taxable","exempt"].includes(status))throw new RangeError("VAT taxpayer status required");
 if(!["general","simplified"].includes(method))throw new RangeError("VAT calculation mode");
 if(!Array.isArray(transactions))throw new TypeError("transactions required");
 const totals={taxableNetSales:0,exemptNetSales:0,outputVAT:0,inputVAT:0,eligibleInputVAT:0,
   grossCashReceipts:0,grossCashPayments:0};
 const names=new Set();
 for(const t of transactions){
  if(!t||typeof t.id!=="string"||!t.id||names.has(t.id))throw new RangeError("duplicate/invalid transaction id");
  names.add(t.id);
  n(t.netAmount,"netAmount",0);n(t.vatAmount,"vatAmount",0);
  if(!["sale","expense","capital"].includes(t.kind))throw new RangeError("transaction kind");
  if(!["taxable","exempt","outOfScope"].includes(t.vatClass))throw new RangeError("VAT class");
  if(t.vatClass!=="taxable"&&t.vatAmount!==0)throw new RangeError("non-taxable transaction cannot bear output/input VAT");
  if(t.kind==="sale"){
    totals.grossCashReceipts+=t.netAmount+t.vatAmount;
    if(t.vatClass==="taxable"){totals.outputVAT+=t.vatAmount;totals.taxableNetSales+=t.netAmount;}
    else if(t.vatClass==="exempt")totals.exemptNetSales+=t.netAmount;
  }else{
    totals.grossCashPayments+=t.netAmount+t.vatAmount;
    totals.inputVAT+=t.vatAmount;
    if(t.vatClass==="taxable"){
      if(!["taxableRelated","exemptRelated","common","private"].includes(t.inputAttribution))
        throw new RangeError("VAT input attribution required");
      if(t.inputAttribution==="taxableRelated")totals.eligibleInputVAT+=t.vatAmount;
      if(t.inputAttribution==="common"){
        if(taxableSalesRatio===null)throw new RangeError("Common input VAT requires supported taxable sales ratio");
        totals.eligibleInputVAT+=t.vatAmount*proportion(taxableSalesRatio,"taxableSalesRatio");
      }
    }
  }
 }
 if(status==="exempt")return {...totals,inputVATCredit:0,netVATPayment:0,refund:0,
   status:"estimated",note:"No deemed refund. VAT included in gross cash receipts/payments"};
 let credit=0;
 if(method==="simplified"){
   if(deemedInputRate===null)throw new RangeError("Business classification/deemed input rate required");
   credit=totals.outputVAT*proportion(deemedInputRate,"deemedInputRate");
 }else{
   if(creditMethod!=="itemized")throw new RangeError("Only itemized credit method implemented");
   credit=hasFullCreditEligibility?totals.inputVAT:totals.eligibleInputVAT;
 }
 const difference=totals.outputVAT-credit;
 if(difference<0&&!confirmedRefundEligibility)return {...totals,inputVATCredit:credit,
  netVATPayment:null,refund:null,status:"incomplete",reason:"VAT refund eligibility unresolved"};
 return {...totals,inputVATCredit:credit,netVATPayment:Math.max(0,difference),
  refund:Math.max(0,-difference),status:"estimated",
  note:"Gross cash receipts and payments include VAT; settlement must be booked once, separately"};
}
