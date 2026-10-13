/**
 * Gate B B-T13/14: officer cash payroll and noncash housing benefits,
 * with explicit NTA monthly withholding-table evidence.
 *
 * NTA 2511: https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2511.htm
 * 2027 table: https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/01.htm
 *
 * No table tax is guessed from gross monthly pay: payroll period, declaration,
 * social contributions, table column and tax-year version are mandatory.
 * Withholding is a prepayment on OFFICER income tax, not a second corporation
 * income tax. Employee cash and employer cash must mirror exactly.
 */
const nta="https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2511.htm";
const table2027="https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/01.htm";
const num=(x,k,min=0)=>{if(typeof x!=="number"||!Number.isFinite(x)||x<min)throw new RangeError(k+" must be finite nonnegative");return x};
const name=(s,k)=>{if(typeof s!=="string"||!s)throw new TypeError(k+" required");return s};
const month=s=>{if(typeof s!=="string"||!/^\d{4}-(0[1-9]|1[0-2])$/.test(s))throw new RangeError("month YYYY-MM");return s};
const near=(a,b)=>Math.abs(a-b)<.001;
export function compileOfficerPayrollMonth({
 payrollId,employerEntityId,officerEntityId,month:payMonth,
 cashSalaryGross,noncashHousingBenefit,employeeSocialInsurance,
 withholdingTax,withholdingRemittanceMonth,socialRemittanceMonth,
 taxTableEvidence,employerExpenseDeductibility
}){
 name(payrollId,"payrollId");name(employerEntityId,"employerEntityId");name(officerEntityId,"officerEntityId");
 if(employerEntityId===officerEntityId)throw new RangeError("payroll must be between distinct legal entities");
 month(payMonth);month(withholdingRemittanceMonth);month(socialRemittanceMonth);
 const gross=num(cashSalaryGross,"cashSalaryGross");
 const housing=num(noncashHousingBenefit,"noncashHousingBenefit");
 const insurance=num(employeeSocialInsurance,"employeeSocialInsurance");
 const withholding=num(withholdingTax,"withholdingTax");
 if(insurance+withholding>gross)throw new RangeError("deductions exceed cash salary; separate remittance funding required");
 if(!taxTableEvidence||taxTableEvidence.taxYear!==Number(payMonth.slice(0,4))||
   !["monthly","daily","bonus"].includes(taxTableEvidence.payPeriod)||
   !["ko","otsu","hei","bonus"].includes(taxTableEvidence.tableColumn)||
   !["reviewedScenario","unverified"].includes(taxTableEvidence.lookupStatus)||
   !name(taxTableEvidence.version,"table version")||
   ![nta,table2027].includes(taxTableEvidence.sourceUrl))
   throw new RangeError("evidence of correct NTA tax-year table missing");
 const taxableSalaryBase=gross+housing-insurance;
 if(!near(taxableSalaryBase,taxTableEvidence.taxableMonthlyBase)||
    !near(withholding,taxTableEvidence.withholdingAmount))
   throw new RangeError("salary base or withheld amount differs from table lookup evidence");
 if(taxTableEvidence.taxYear===2027&&taxTableEvidence.sourceUrl!==table2027)
   throw new RangeError("2027 taxes require 2027 withholding tax table");
 if(taxTableEvidence.taxYear!==2027&&taxTableEvidence.sourceUrl===table2027)
   throw new RangeError("2027 withholding table cannot be reused for earlier/later tax years");
 if(!["reviewedDeductible","reviewedNotDeductible","unknown"].includes(employerExpenseDeductibility))
   throw new RangeError("corporate officer remuneration deduction requires explicit legal treatment");
 const net=gross-insurance-withholding;
 const cashEvents=[
  {id:payrollId+":employerSalary",entityId:employerEntityId,month:payMonth,
   category:"officerCashSalaryNet",amount:-net},
  {id:payrollId+":officerReceipt",entityId:officerEntityId,month:payMonth,
   category:"officerCashSalaryNet",amount:net},
  {id:payrollId+":taxAuthority",entityId:employerEntityId,month:withholdingRemittanceMonth,
   category:"payrollTaxRemittance",amount:-withholding},
  {id:payrollId+":socialInsurance",entityId:employerEntityId,month:socialRemittanceMonth,
   category:"employeeSocialInsuranceRemittance",amount:-insurance}
 ];
 return {payrollId,employerEntityId,officerEntityId,month:payMonth,
  taxableGrossSalary:gross+housing,taxableMonthlyBase:taxableSalaryBase,
  grossCashSalary:gross,noncashHousingBenefit:housing,
  employerEconomicGrossCost:gross,employeeCashReceipt:net,
  incomeTaxPrepayment:withholding,employeeSocialInsurance:insurance,
  cashEvents,status:taxTableEvidence.lookupStatus==="reviewedScenario" &&
    employerExpenseDeductibility!=="unknown"?"estimated":"incomplete",
  expenseTreatment:employerExpenseDeductibility,
  sourceUrl:taxTableEvidence.sourceUrl,
  note:"No cash created for housing benefit; employer+officer cash transfer cancels at group level; withholding is employee prepayment"};
}
/** Corporate salary cost is gross cash salary; do not also expense its cash
 * deductions or noncash benefit as an additional payroll outflow. */
export function payrollCorporateTaxItems({payrollMonths,taxYear,employerEntityId}){
 if(!Array.isArray(payrollMonths)||!Number.isInteger(taxYear)||!name(employerEntityId,"employerEntityId"))
   throw new TypeError("monthly payroll and year required");
 const ids=new Set();let gross=0,nonDeductible=0;
 for(const p of payrollMonths){
  if(p.employerEntityId!==employerEntityId||
     Number(p.month.slice(0,4))!==taxYear||ids.has(p.payrollId)||p.status!=="estimated")
    throw new RangeError("duplicate/unknown payroll or tax status");
  ids.add(p.payrollId);gross+=p.grossCashSalary;
  if(p.expenseTreatment==="reviewedNotDeductible")nonDeductible+=p.grossCashSalary;
 }
 return {taxYear,employerEntityId,totalGrossSalary:gross,
  bookedExpense:{entityId:employerEntityId,taxYear,category:"corporate",kind:"deductibleExpense",amount:gross,
   source:"officerPayrollExpense"},
  nondeductibleAddback:{entityId:employerEntityId,taxYear,category:"corporate",kind:"adjustment",
   amount:nonDeductible,source:"officerPayrollNonDeductibleAddback"},
  note:"Gross salary only; do not book net officer receipt or taxes withheld as extra expense"};
}
/**
 * Sources of annual individual income tax must already include wages/noncash
 * benefit. Amount remitted by employer is prepaid individual tax, so cash
 * remaining after annual assessment must subtract paid withholding.
 * A potential refund requires separate confirmation; no automatic inflow.
 */
export function reconcileAnnualPayrollPrepayment({
 officerEntityId,taxYear,assessedWithProject,assessedWithoutProject,
 withheldWithProject,withheldWithoutProject,
 projectRemittanceEvidence,baselineRemittanceEvidence
}){
 name(officerEntityId,"officerEntityId");
 if(!Number.isInteger(taxYear)||taxYear<1900)throw new RangeError("year required");
 const withAmt=num(assessedWithProject,"assessedWithProject");
 const baseAmt=num(assessedWithoutProject,"assessedWithoutProject");
 const withHeld=num(withheldWithProject,"withheldWithProject");
 const baseHeld=num(withheldWithoutProject,"withheldWithoutProject");
 for(const [label,p,amount] of [["project",projectRemittanceEvidence,withHeld],
  ["baseline",baselineRemittanceEvidence,baseHeld]]){
  if(!p||p.entityId!==officerEntityId||p.taxYear!==taxYear||
    p.withholdingRemitted!==true||!near(p.remittedAmount,amount)||
    typeof p.sourceId!=="string"||!p.sourceId)
      throw new RangeError(label+" source prepayment remittance proof required");
 }
 const projectUnpaid=withAmt-withHeld,baselineUnpaid=baseAmt-baseHeld;
 if(projectUnpaid<0||baselineUnpaid<0)return {status:"incomplete",
   cashPayableWithProject:null,cashPayableWithoutProject:null,
   potentialProjectRefund:Math.max(0,-projectUnpaid),
   potentialBaselineRefund:Math.max(0,-baselineUnpaid),
   note:"Tax refund eligibility/payment not verified; no positive cash event"};
 return {status:"estimated",entityId:officerEntityId,taxYear,
  cashPayableWithProject:projectUnpaid,cashPayableWithoutProject:baselineUnpaid,
  incrementalFinalIncomeTaxCash:-(projectUnpaid-baselineUnpaid),
  withholdingCashAlreadyRemittedWithProject:withHeld,
  withholdingCashAlreadyRemittedWithoutProject:baseHeld,
  taxAssessmentDelta:withAmt-baseAmt,
  reconciliation:(withAmt-baseAmt)-(withHeld-baseHeld)-(projectUnpaid-baselineUnpaid),
  note:"A withholding amount credited to individual annual tax has already left the group via employer payroll tax remittance"};
}
