/**
 * Gate A §13.4 DSCR/CFADS on taxpayer-level cash settlement basis.
 * Scheduled principal + interest only; prepayment is a separate cash flow.
 * Figures are simulator definitions, not lender covenant calculations.
 */
const num=(x,name)=>{if(typeof x!=="number"||!Number.isFinite(x))throw new TypeError(name+" must be finite");return x;};
const key=x=>{if(typeof x!=="string"||!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(x))throw new RangeError("YYYY-MM required");return x;};
const close=(a,b)=>Math.abs(a-b)<=1e-6;
export function calculateEntityDSCR({
 entityId,month,operatingSurplus,maintenanceCapEx,deltaOperatingNWC,
 incrementalCashIncomeTaxPaid,scheduledPrincipal,interestPaid,
 prepaymentPrincipal=0,prepaymentFee=0
}){
 if(typeof entityId!=="string"||!entityId)throw new TypeError("entityId required");
 key(month);
 for(const [k,v] of Object.entries({operatingSurplus,maintenanceCapEx,deltaOperatingNWC,
  incrementalCashIncomeTaxPaid,scheduledPrincipal,interestPaid,prepaymentPrincipal,prepaymentFee}))num(v,k);
 if([maintenanceCapEx,scheduledPrincipal,interestPaid,prepaymentPrincipal,prepaymentFee].some(x=>x<0))
   throw new RangeError("payment components may not be negative");
 // Incremental taxes may be negative if and only if the upstream cash flow
 // engine has validated the receipt (e.g. confirmed refund).
 const preTaxCFADS=operatingSurplus-maintenanceCapEx-deltaOperatingNWC;
 const afterTaxCFADS=preTaxCFADS-incrementalCashIncomeTaxPaid;
 const debtService=scheduledPrincipal+interestPaid;
 const dscr=debtService>0?afterTaxCFADS/debtService:null;
 const postScheduledDebtCF=afterTaxCFADS-debtService;
 return {entityId,month,preTaxCFADS,afterTaxCFADS,debtService,DSCR:dscr,
  dscrStatus:debtService===0?"notApplicable":afterTaxCFADS<0?"negative":"computed",
  postScheduledDebtCF,
  postDebtCashAfterPrepayment:postScheduledDebtCF-prepaymentPrincipal-prepaymentFee,
  scheduledPrincipal,interestPaid,prepaymentPrincipal,prepaymentFee,
  note:"Prepayments are excluded from the contractual scheduled debt-service denominator"};
}
/**
 * Adapt period interest/principal records from a loan schedule. Caller must
 * provide all economically attributable loans for the same taxpayer.
 */
export function groupScheduledDebtService({entityId,month,loanPayments}){
 if(!Array.isArray(loanPayments))throw new TypeError("loanPayments array required");
 key(month);
 const seen=new Set();let scheduledPrincipal=0,interestPaid=0,prepaymentPrincipal=0,prepaymentFee=0;
 for(const p of loanPayments){
   if(typeof p.loanId!=="string"||!p.loanId||seen.has(p.loanId))throw new RangeError("duplicate loanId");
   seen.add(p.loanId);
   if(p.entityId!==entityId||p.month!==month)throw new RangeError("loan belongs to another entity or month");
   for(const [k,v] of Object.entries({scheduledPrincipal:p.scheduledPrincipal,interestPaid:p.interest,
     prepaymentPrincipal:p.prepayment,prepaymentFee:p.prepaymentFee}))num(v,k);
   if([p.scheduledPrincipal,p.interest,p.prepayment,p.prepaymentFee].some(x=>x<0))
     throw new RangeError("negative payment");
   if(p.scheduledDebtService!==undefined&&!close(p.scheduledDebtService,p.scheduledPrincipal+p.interest))
     throw new RangeError("scheduled debt service detail mismatch");
   scheduledPrincipal+=p.scheduledPrincipal;
   interestPaid+=p.interest;prepaymentPrincipal+=p.prepayment;prepaymentFee+=p.prepaymentFee;
 }
 return {scheduledPrincipal,interestPaid,prepaymentPrincipal,prepaymentFee};
}
