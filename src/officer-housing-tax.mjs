/**
 * Gate B B-T12/13/14 officer housing, tax attribution and source evidence.
 *
 * NTA officer housing (2026-04-01): https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2600.htm
 * NTA economic benefits: https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/5202.htm
 *
 * Taxable officer salary is NONCASH imputed benefit; rent is a distinct
 * mirrored cash transfer (if actually paid). Never infer that officer
 * imputed remuneration is deductible by the corporation.
 */
const n=(x,k,{min=0,max=Infinity}={})=>{if(typeof x!=="number"||!Number.isFinite(x)||x<min||x>max)throw new RangeError(k+" must be finite in range");return x;};
const id=(x,k)=>{if(typeof x!=="string"||!x)throw new TypeError(k+" must be nonempty string");return x;};
const checkMonth=x=>{if(typeof x!=="string"||!/^\d{4}-(0[1-9]|1[0-2])$/.test(x))throw new RangeError("YYYY-MM required");return x;};
const officerSource="https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2600.htm";
const corporateSource="https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/5202.htm";
export function calculateOfficerHousingTaxMonth({
 corporationId,officerId,month,classification,companyTenure,
 buildingUsefulLifeYears,totalFloorAreaSqm,buildingFixedTaxBase,landFixedTaxBase,
 landlordRentPaidByCorporation=0,normalMarketRent=null,
 officerRentPaid,excludedLuxuryStatus,classificationEvidenceUrl,
 rentCashProof=null,corporateExpenseTreatment,bookedOfficerBenefitExpense
}){
 id(corporationId,"corporationId");id(officerId,"officerId");
 if(corporationId===officerId)throw new RangeError("corporation/officer entities must differ");
 checkMonth(month);
 if(!Number.isInteger(buildingUsefulLifeYears)||buildingUsefulLifeYears<1)
   throw new RangeError("buildingUsefulLifeYears required");
 const area=n(totalFloorAreaSqm,"totalFloorAreaSqm",{min:Number.MIN_VALUE});
 n(buildingFixedTaxBase,"buildingFixedTaxBase");
 n(landFixedTaxBase,"landFixedTaxBase");
 n(officerRentPaid,"officerRentPaid");
 n(landlordRentPaidByCorporation,"landlordRentPaidByCorporation");
 if(!["owned","leased"].includes(companyTenure))throw new RangeError("corporate housing tenure required");
 if(!["small","ordinary","luxury"].includes(classification))throw new RangeError("classification required");
 if(!classificationEvidenceUrl?.startsWith("https://"))throw new RangeError("classification evidence URL required");
 const smallLimit=buildingUsefulLifeYears<=30?132:99;
 if(classification==="small"&&area>smallLimit)throw new RangeError("small housing statutory area limit exceeded");
 if(classification==="ordinary"&&area<=smallLimit)throw new RangeError("small-vs-ordinary housing classification must be reviewed");
 if(classification!=="luxury"&&excludedLuxuryStatus!=="reviewedNotLuxury")
   throw new RangeError("luxury status not reviewed");
 if(classification==="luxury"&&excludedLuxuryStatus!=="reviewedLuxury")
   throw new RangeError("luxury determination not reviewed");
 let rentEquivalent;
 if(classification==="small"){
   rentEquivalent=buildingFixedTaxBase*.002+12*(area/3.3)+landFixedTaxBase*.0022;
 }else if(classification==="ordinary"){
   const owned=(buildingFixedTaxBase*(buildingUsefulLifeYears>30?.10:.12)+landFixedTaxBase*.06)/12;
   rentEquivalent=companyTenure==="leased"?Math.max(landlordRentPaidByCorporation*.5,owned):owned;
 }else{
   rentEquivalent=n(normalMarketRent,"normalMarketRent");
 }
 const imputedSalaryBenefit=Math.max(0,rentEquivalent-officerRentPaid);
 // The paid rent is already in the officer/person and corporation ledgers.
 // This module audits, but NEVER creates a second cash receipt.
 if(officerRentPaid>0){
   if(!rentCashProof || rentCashProof.officerEntityId!==officerId||
    rentCashProof.corporationEntityId!==corporationId||
    rentCashProof.month!==month||
    rentCashProof.officerPayment!==-officerRentPaid||
    rentCashProof.corporationReceipt!==officerRentPaid)
      throw new RangeError("actual officer rent requires mirrored and dated cash proof");
 }else if(rentCashProof!==null)throw new RangeError("zero rent cannot have cash mirror");
 if(!["notBooked","deductibleReviewed","nonDeductibleReviewed","unknown"].includes(corporateExpenseTreatment))
   throw new RangeError("corporate book-to-tax expense treatment missing");
 n(bookedOfficerBenefitExpense,"bookedOfficerBenefitExpense");
 if(corporateExpenseTreatment==="notBooked"&&bookedOfficerBenefitExpense!==0)
   throw new RangeError("expense not booked but amount exists");
 if(corporateExpenseTreatment==="unknown")return {corporationId,officerId,month,
   rentEquivalent,imputedSalaryBenefit,corporateNondeductibleAddback:null,
   status:"incomplete",reason:"Corporate officer remuneration deductibility unknown"};
 // A previously recorded expense can be adjusted (added back) only if
 // independently classified as non-deductible. No new expense created.
 const corporateNondeductibleAddback=corporateExpenseTreatment==="nonDeductibleReviewed"?
    bookedOfficerBenefitExpense:0;
 return {corporationId,officerId,month,classification,companyTenure,
   rentEquivalent,officerRentPaid,imputedSalaryBenefit,
   bookedOfficerBenefitExpense,corporateNondeductibleAddback,
   status:"estimated",sources:{officerSalary:officerSource,corporateTreatment:corporateSource,
    classificationEvidenceUrl},
   notes:["Imputed salary is added to individual ordinary taxable income, not miscellaneous lodging income",
    "Corporate deduction is never inferred from imputed rent; addback only adjusts expense already booked",
    "Rent paid is booked separately in each legal entity and cancels in group cash if mirrored"]};
}
/** Convert 12 dated records to person salary and corporate taxable-income adjustment. */
export function summarizeOfficerHousingTaxYear({corporationId,officerId,taxYear,months}){
 id(corporationId,"corporationId");id(officerId,"officerId");
 if(!Number.isInteger(taxYear)||taxYear<1900||!Array.isArray(months)||!months.length)
   throw new TypeError("year and monthly records required");
 const seen=new Set(),records=[];
 for(const item of months){
   if(item?.status!=="estimated"||item.corporationId!==corporationId||item.officerId!==officerId||
      Number(item.month?.slice(0,4))!==taxYear||seen.has(item.month))
     throw new RangeError("monthly housing tax result missing, invalid or duplicated");
   seen.add(item.month);records.push(item);
 }
 const salaryBenefit=records.reduce((a,x)=>a+x.imputedSalaryBenefit,0);
 const corporateAddback=records.reduce((a,x)=>a+x.corporateNondeductibleAddback,0);
 return {corporationId,officerId,taxYear,salaryBenefit,corporateAddback,monthCount:records.length,
   corporateTaxItems:corporateAddback===0?[]:[{entityId:corporationId,taxYear,category:"corporate",
     kind:"adjustment",amount:corporateAddback,source:"officerHousingNondeductibleBookedBenefit"}],
   status:"estimated",sourceUrls:[officerSource,corporateSource],
   note:"Noncash officer salary and nondeductible addback only; any actual rent must already be booked in legal-entity taxable revenue/expense and cash ledgers"};
}
