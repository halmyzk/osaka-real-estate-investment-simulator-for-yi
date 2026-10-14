/**
 * Gate B residential rental building VAT input-credit adjustments.
 * Public primary source with both formulae & independent numeric examples:
 * https://www.nta.go.jp/publication/pamph/shohi/r02kaisei.pdf (page 2).
 *
 * Separate rules:
 * - Retained at end of third taxable period + taxable rental use within
 *   adjustment window: input VAT × taxable rental consideration / all rental.
 * - Disposal within adjustment window: input VAT ×
 *   (taxable rental consideration + taxable building sale consideration) /
 *   (all rental consideration + taxable building sale consideration).
 *
 * Period eligibility is explicitly reviewed; no VAT cash or refund emitted.
 */
const sourceUrl="https://www.nta.go.jp/publication/pamph/shohi/r02kaisei.pdf";
const text=(x,k)=>{if(typeof x!=="string"||!x)throw new TypeError(k+" required");return x};
const amt=(x,k,{min=0,max=Infinity}={})=>{if(typeof x!=="number"||!Number.isFinite(x)||x<min||x>max)throw new RangeError(k+" invalid");return x};
const date=(s,k)=>{
 text(s,k);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new RangeError(k+" must be ISO date");
 const d=new Date(s+"T00:00:00Z");
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)throw new RangeError(k+" invalid date");
 return s;
};
export function assessResidentialBuildingVATLaterAdjustment({
 assetId,entityId,acquiredAt,thirdTaxPeriodEnd,taxPeriodEnd,
 eventType,eventDate,reviewedLegalEligibility,heldAtThirdPeriodEnd,
 restrictedAcquisitionVAT,taxableRentalConsideration,
 exemptRentalConsideration,buildingDisposalConsideration=0,
 ruleVersion,sourceReference=sourceUrl
}){
 text(assetId,"assetId");text(entityId,"entityId");
 const acquired=date(acquiredAt,"acquiredAt");
 const third=date(thirdTaxPeriodEnd,"thirdTaxPeriodEnd");
 const event=date(eventDate,"eventDate");
 const period=date(taxPeriodEnd,"taxPeriodEnd");
 if(acquired>third||event<acquired||event>third)throw new RangeError("event outside reviewed three-period adjustment window");
 if(!["retainedTaxableRental","disposed"].includes(eventType))throw new RangeError("adjustment event");
 if(sourceReference!==sourceUrl||!ruleVersion)throw new RangeError("exact statutory adjustment rule provenance required");
 if(reviewedLegalEligibility===null||reviewedLegalEligibility===undefined||
    !["reviewedEligible","reviewedIneligible","unknown"].includes(reviewedLegalEligibility))
   throw new RangeError("eligibility status must be explicit");
 const acquisitionVAT=amt(restrictedAcquisitionVAT,"restrictedAcquisitionVAT");
 const taxable=amt(taxableRentalConsideration,"taxableRentalConsideration");
 const exempt=amt(exemptRentalConsideration,"exemptRentalConsideration");
 const sale=amt(buildingDisposalConsideration,"buildingDisposalConsideration");
 const metadata={assetId,entityId,sourceUrl,ruleVersion,taxPeriodEnd:period,
   eventType,status:"estimated",acquiredAt,thirdTaxPeriodEnd:third};
 if(reviewedLegalEligibility==="unknown")return {...metadata,status:"incomplete",inputVATCreditAdjustment:null,
    cashRefund:null,reason:"Taxpayer/asset/period eligibility unknown; no cash refund"};
 if(reviewedLegalEligibility==="reviewedIneligible")
   return {...metadata,inputVATCreditAdjustment:0,cashRefund:null,
    note:"Reviewed not eligible, tax credit adjustment is zero; no implied settlement"};
 if(eventType==="retainedTaxableRental"){
   if(heldAtThirdPeriodEnd!==true||period!==third)
     throw new RangeError("taxable rental formula requires retained building at third-period end");
   if(sale!==0)throw new RangeError("retained building cannot have sale consideration");
   if(taxable<=0||taxable+exempt===0)
     throw new RangeError("taxable rental use and valid rental denominator required");
 }else{
   if(heldAtThirdPeriodEnd!==false||period<event||period>third)
     throw new RangeError("disposed building requires disposition-period alignment");
   if(sale<=0)throw new RangeError("positive building-only disposal consideration required");
 }
 const numerator=taxable+(eventType==="disposed"?sale:0);
 const denominator=taxable+exempt+(eventType==="disposed"?sale:0);
 if(denominator<=0||numerator>denominator)throw new RangeError("invalid VAT adjustment consideration");
 const adjustment=acquisitionVAT*(numerator/denominator);
 return {...metadata,eligibleFraction:numerator/denominator,
   inputVATCreditAdjustment:adjustment,
   numeratorConsideration:numerator,denominatorConsideration:denominator,
   cashRefund:null,notACashEvent:true,
   note:"Input tax credit supplement at relevant tax period only. Book any payment or refund separately after confirmed settlement, without duplicating gross property-sale cash"};
}
/** Bridge adjustment into a VAT assessment; does NOT generate settlement cash. */
export function computeVATWithReviewedResidentialAdjustment({
 entityId,taxPeriodEnd,outputVAT,ordinaryEligibleInputVAT,residentialAdjustments,
 actualRefundConfirmed=false
}){
 text(entityId,"entityId");date(taxPeriodEnd,"taxPeriodEnd");
 const output=amt(outputVAT,"outputVAT"),input=amt(ordinaryEligibleInputVAT,"ordinaryEligibleInputVAT");
 if(!Array.isArray(residentialAdjustments))throw new TypeError("all adjustment results required");
 const ids=new Set();let totalAdjustment=0;
 for(const x of residentialAdjustments){
   if(x.entityId!==entityId||x.taxPeriodEnd!==taxPeriodEnd||!x.assetId||ids.has(x.assetId))
     throw new RangeError("wrong entity/period or duplicate adjustment");
   ids.add(x.assetId);
   if(x.status!=="estimated"||x.notACashEvent!==true)
     throw new RangeError("unverified residential VAT input-credit adjustment");
   totalAdjustment+=amt(x.inputVATCreditAdjustment,"inputVATCreditAdjustment");
 }
 const taxAssessment=output-input-totalAdjustment;
 const possibleRefund=taxAssessment<0?-taxAssessment:0;
 if(possibleRefund>0&&!actualRefundConfirmed)
   return {entityId,taxPeriodEnd,status:"incomplete",taxAssessment,
    paymentDue:0,refundEligible:null,
    reason:"Negative VAT assessment does not itself establish a realizable refund"};
 return {entityId,taxPeriodEnd,status:"estimated",taxAssessment,
   paymentDue:Math.max(0,taxAssessment),
   refundEligible:possibleRefund,refundCashBooked:false,
   ordinaryEligibleInputVAT:input,residentialAdjustment:totalAdjustment,
   note:"Settlement cash requires separate confirmed payment/refund event"};
}
