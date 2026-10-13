/**
 * Make assessed individual income tax cash-payable after employer-remitted
 * withholding, without touching other tax heads (resident tax, capital gain).
 * Do NOT use it for withholding-only salary-tax return assumptions unless
 * all other income/deductions are present in assessPersonalYear().
 */
import {reconcileAnnualPayrollPrepayment} from "./officer-payroll-withholding.mjs";
const nonempty=(s,k)=>{if(typeof s!=="string"||!s)throw new TypeError(k+" required");return s;};
export function bridgePersonalAnnualIncomeTaxWithPayroll({
 personalYearAssessment,
 withheldWithProject,withheldWithoutProject,
 projectRemittanceEvidence,baselineRemittanceEvidence
}){
 if(personalYearAssessment?.entityType!=="individual"||
   !["computed","estimated"].includes(personalYearAssessment.status))
   throw new RangeError("completed personal annual tax assessment required");
 const entityId=nonempty(personalYearAssessment.entityId,"entityId");
 const taxYear=personalYearAssessment.taxYear;
 if(!Number.isInteger(taxYear)||!Array.isArray(personalYearAssessment.assessmentsWithProject)||
    !Array.isArray(personalYearAssessment.assessmentsWithoutProject))
   throw new RangeError("annual personal tax assessment and year required");
 const get=(items)=>{
   const candidates=items.filter(x=>x.taxKind==="incomeTax");
   if(candidates.length!==1||candidates[0].taxYear!==taxYear||candidates[0].entityId!==entityId)
     throw new RangeError("exactly one individual income-tax assessment per scenario required");
   return candidates[0];
 };
 const withRec=get(personalYearAssessment.assessmentsWithProject);
 const baseRec=get(personalYearAssessment.assessmentsWithoutProject);
 const prepayment=reconcileAnnualPayrollPrepayment({
   officerEntityId:entityId,taxYear,
   assessedWithProject:withRec.amount,
   assessedWithoutProject:baseRec.amount,
   withheldWithProject,withheldWithoutProject,
   projectRemittanceEvidence,baselineRemittanceEvidence
 });
 if(prepayment.status!=="estimated")return {
   status:"incomplete",prepayment,
   assessmentsWithProject:[],assessmentsWithoutProject:[],
   reason:"No automatic income-tax refund from unpaid or unverified withholding credits"};
 const replaced=(arr,newIncomeTax)=>arr.map(x=>x.taxKind==="incomeTax"?
   {...x,amount:newIncomeTax,
    originalAssessedIncomeTax:x.amount,withholdingApplied:true}:x);
 return {entityId,taxYear,status:"estimated",prepayment,
   assessmentsWithProject:replaced(personalYearAssessment.assessmentsWithProject,
     prepayment.cashPayableWithProject),
   assessmentsWithoutProject:replaced(personalYearAssessment.assessmentsWithoutProject,
     prepayment.cashPayableWithoutProject),
   note:"Feed ONLY adjusted income-tax assessments to cash scheduler; employer withholding remittances are separately booked external cash"};
}
