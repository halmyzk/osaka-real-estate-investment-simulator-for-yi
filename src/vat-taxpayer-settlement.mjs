/**
 * Gate B B-T16/17/24: VAT taxpayer qualification and cash settlement evidence.
 *
 * NTA No.6501 https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6501.htm
 * NTA No.6503 https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6503.htm
 * NTA No.6613 https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6613.htm
 *
 * Explicit applicability gates: a simple <10m base period is NOT proof of
 * exemption (invoice registration, elected taxation, specific period,
 * new company capital, merger/inheritance and capital-asset restrictions).
 *
 * No tax payable is assumed cash until dated remittance is evidenced.
 */
const NTA="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6501.htm";
const num=(x,k,min=0)=>{if(typeof x!=="number"||!Number.isFinite(x)||x<min)throw new RangeError(k+" must be nonnegative finite");return x};
const nonempty=(s,k)=>{if(typeof s!=="string"||!s)throw new TypeError(k+" required");return s};
const date=(s,k)=>{nonempty(s,k);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new RangeError(k+" YYYY-MM-DD required");const d=new Date(s+"T00:00:00Z");if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==s)throw new RangeError(k+" invalid date");return s;};
const boolOrUnknown=x=>x===true||x===false||x==="unknown";
export function reviewVATTaxpayerPeriod({
 entityId,taxPeriodStart,taxPeriodEnd,taxpayerType,foreignTaxpayerClassification,
 baselinePeriodTaxableSales,specificPeriodTaxableSales,
 specialPeriodAlternativePayrollAmount,specificPeriodTestBasis,
 invoiceRegistration,electedTaxableStatus,
 newCorporationCapital,newCorporation,
 capitalOrReorganizationException,
 largeAssetTaxationRestriction,
 method,taxRule
}){
 nonempty(entityId,"entityId");
 const start=date(taxPeriodStart,"taxPeriodStart"),end=date(taxPeriodEnd,"taxPeriodEnd");
 if(end<start)throw new RangeError("VAT tax period inverted");
 if(!["individual","corporation"].includes(taxpayerType))
   throw new RangeError("taxpayer type required");
 if(!["domestic","foreign","unknown"].includes(foreignTaxpayerClassification))
   throw new RangeError("foreign taxpayer classification required");
 if(!taxRule||taxRule.sourceUrl!==NTA||!nonempty(taxRule.ruleVersion,"ruleVersion")||
   taxRule.applicabilityReviewed!==true)
   throw new RangeError("versioned VAT statutory classification review required");
 if(!["general","simplified","unknown"].includes(method))
   throw new RangeError("tax calculation method must be explicit");
 for(const [k,v] of Object.entries({
   electedTaxableStatus,capitalOrReorganizationException,
   largeAssetTaxationRestriction,newCorporation
 }))if(!boolOrUnknown(v))throw new RangeError(k+" needs true/false/unknown");
 if(invoiceRegistration===undefined||invoiceRegistration===null ||
    !["none","registeredWholePeriod","registeredPartPeriod","unknown"].includes(invoiceRegistration))
   throw new RangeError("invoice registration period needs explicit review");
 if(!["taxableSales","payrollAlternative","unknown"].includes(specificPeriodTestBasis))
   throw new RangeError("specific-period determination method requires selection");
 if(baselinePeriodTaxableSales!==null)num(baselinePeriodTaxableSales,"baselinePeriodTaxableSales");
 if(specificPeriodTaxableSales!==null)num(specificPeriodTaxableSales,"specificPeriodTaxableSales");
 if(specialPeriodAlternativePayrollAmount!==null)
   num(specialPeriodAlternativePayrollAmount,"specialPeriodAlternativePayrollAmount");
 if(newCorporationCapital!==null)num(newCorporationCapital,"newCorporationCapital");
 const issues=[];
 if(foreignTaxpayerClassification==="unknown")
   issues.push("Domestic/foreign taxpayer status unknown");
 if(foreignTaxpayerClassification==="foreign"&&
    start>="2024-10-01"&&specificPeriodTestBasis==="payrollAlternative")
   issues.push("Foreign taxpayer may not use payroll special-period alternative after 2024-10-01");
 if(method==="simplified"&&largeAssetTaxationRestriction===true)
   issues.push("Qualifying high-value capital asset may prohibit simplified tax method");
 if(invoiceRegistration==="registeredPartPeriod")
   issues.push("Partial-period invoice registration needs dated split before net VAT assessment");
 if(invoiceRegistration==="unknown"||electedTaxableStatus==="unknown"||
    capitalOrReorganizationException==="unknown"||largeAssetTaxationRestriction==="unknown"||
    newCorporation==="unknown")
   issues.push("Unknown mandatory tax status exception");
 if(baselinePeriodTaxableSales===null&&newCorporation!==true)
   issues.push("Base-period taxable sales missing");
 if(newCorporation===true&&taxpayerType!=="corporation")throw new RangeError("new corporate capital exception for corporation only");
 if(newCorporation===true&&newCorporationCapital===null)issues.push("New corporation capitalization missing");
 let specificPeriodForcesTaxable=false;
 if(specificPeriodTestBasis==="taxableSales"){
   if(specificPeriodTaxableSales===null)issues.push("Specific period taxable sales missing");
   else specificPeriodForcesTaxable=specificPeriodTaxableSales>10000000;
 }else if(specificPeriodTestBasis==="payrollAlternative"){
   if(specialPeriodAlternativePayrollAmount===null)
     issues.push("Special-period alternative payroll evidence missing");
   else specificPeriodForcesTaxable=specialPeriodAlternativePayrollAmount>10000000;
 }else issues.push("Special-period comparison method not reviewed");
 const unavoidableTaxable=(baselinePeriodTaxableSales!==null&&baselinePeriodTaxableSales>10000000)||
    electedTaxableStatus===true||invoiceRegistration==="registeredWholePeriod"||
    specificPeriodForcesTaxable||
    capitalOrReorganizationException===true||largeAssetTaxationRestriction===true||
    (newCorporation===true&&newCorporationCapital!==null&&newCorporationCapital>=10000000);
 if(method==="unknown")issues.push("VAT calculation method undefined");
 if(issues.length)return {entityId,taxPeriodStart:start,taxPeriodEnd:end,
   status:"incomplete",taxpayerStatus:null,issues,
   sourceUrl:NTA,note:"No assumed exemption or input VAT refund"};
 return {entityId,taxPeriodStart:start,taxPeriodEnd:end,
  status:"estimated",taxpayerStatus:unavoidableTaxable?"taxable":"exempt",
  method,sourceUrl:NTA,ruleVersion:taxRule.ruleVersion,
  evidence:{basePeriodSales:baselinePeriodTaxableSales,
    specificPeriodTestBasis,invoiceRegistration,newCorporation,foreignTaxpayerClassification},
  note:"Scenario classification only: full statutory exceptions and filing eligibility need independent tax professional review"};
}
/**
 * Connect assessed VAT and EXACTLY matching actually paid/refunded cash.
 * Adjustment or a negative tax assessment does not create cash automatically.
 * The returned taxSettlements may be passed to compileVATInclusiveCash()
 * exactly once. Source gross operating/capital receipts must be separate.
 */
export function reconcileVATAssessmentAndSettlement({
 vatTaxpayerPeriod,assessment,settlements,alreadyBookedVATSettlement=false
}){
 if(vatTaxpayerPeriod?.status!=="estimated"||
   !["taxable","exempt"].includes(vatTaxpayerPeriod.taxpayerStatus))
   throw new RangeError("VAT taxpayer status uncertain");
 if(!assessment||!Array.isArray(settlements)||alreadyBookedVATSettlement!==false)
   throw new RangeError("isolated assessment and cash settlements required");
 const entityId=vatTaxpayerPeriod.entityId;
 if(assessment.entityId!==entityId||
    assessment.taxPeriodEnd!==vatTaxpayerPeriod.taxPeriodEnd||
    !["estimated","computed"].includes(assessment.status)||
    !nonempty(assessment.assessmentId,"assessmentId"))
   throw new RangeError("VAT assessment identity/date/status mismatch");
 const amount=num(assessment.taxAmountAbs,"taxAmountAbs");
 if(!["payment","refund","none"].includes(assessment.settlementKind))
   throw new RangeError("VAT settlement kind needs assessed direction");
 if(vatTaxpayerPeriod.taxpayerStatus==="exempt"&&(amount!==0||assessment.settlementKind!=="none"))
   throw new RangeError("exempt taxpayer cannot recognize VAT filing/credit without reviewed special case");
 if((amount===0)!==(assessment.settlementKind==="none"))
   throw new RangeError("VAT assessment amount and direction inconsistent");
 const seen=new Set(),events=[],unconfirmed=[];
 for(const s of settlements){
   nonempty(s.id,"settlement id");if(seen.has(s.id))throw new RangeError("duplicate settlement receipt");
   seen.add(s.id);
   if(s.entityId!==entityId||s.assessmentId!==assessment.assessmentId||
      s.kind!==assessment.settlementKind||s.kind==="none")
     throw new RangeError("settlement direction/assessment mismatch");
   date(s.cashDate,"cashDate");
   const paid=num(s.amount,"actual settlement amount");
   if(s.confirmedPaidOrRefunded!==true)unconfirmed.push(s.id);
   events.push({id:s.id,entityId,month:s.cashDate.slice(0,7),
     kind:s.kind,amount:paid,refundConfirmed:s.kind==="refund"&&s.confirmedPaidOrRefunded===true});
 }
 const actual=events.reduce((a,b)=>a+b.amount,0);
 const balanced=Math.abs(actual-amount)<=1e-6;
 if(!balanced||unconfirmed.length)return {entityId,status:"incomplete",
   outstandingAmount:amount-actual,unconfirmedSettlementIds:unconfirmed,
   taxSettlements:[],reason:"VAT assessment is not an actual fully confirmed cash settlement"};
 return {entityId,taxPeriodEnd:assessment.taxPeriodEnd,status:"reconciled",
  assessedAmount:amount,actualPaidOrRefunded:actual,
  taxSettlements:events,unconfirmedSettlementIds:[],
  note:"VAT refund/payment verified on dated receipts; this is not a second VAT tax expense or second input invoice cash"};
}
