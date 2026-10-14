/**
 * v1.1 Gate A -> Gate B evidence crosswalk (AUDIT ONLY).
 *
 * Collect per-entity/per-calendar-year operating revenues, nominal expenses,
 * cash interest and capital movements without assuming these equal legally
 * taxable income or deductible expenses. Debt drawdown, principal and asset
 * disposition gross cash are explicitly excluded from operating tax revenue.
 *
 * Designed as the next input layer for tax rules, depreciation and VAT.
 * NEVER convert an audit row into an income-tax assessment automatically.
 */
const numeric=(x,k)=>{if(typeof x!=="number"||!Number.isFinite(x))throw new RangeError(k+" must be finite");return x;};
const sum=x=>x.reduce((a,b)=>a+b,0);
const unclaimed=(rows)=>rows.some(r=>r.tag==="requiresStatutoryTreatment");
export function buildV11TaxSourceCrosswalk({document,unitResults}){
 if(!document||!Array.isArray(document.entities)||!Array.isArray(unitResults))
   throw new TypeError("real saved portfolio and operating-unit calculations required");
 const statuses=new Map(document.entities.map(e=>[e.id,e]));
 if(statuses.size!==document.entities.length)throw new RangeError("duplicate tax entity");
 const rows=new Map(),seen=new Set();
 const line=(entityId,year)=>{
   const key=entityId+"|"+year;
   if(!rows.has(key))rows.set(key,{
     entityId,taxYear:year,lodgingRevenue:0,rentalRevenue:0,
     lodgingOperatingExpense:0,rentalOperatingExpense:0,
     propertyOperatingExpense:0,masterRentExpense:0,
     operatingSurplus:0,interestCashPaid:0,
     principalPaid:0,debtDrawdowns:0,
     purchaseCapitalCash:0,capitalExpenditureCash:0,
     disposalGrossCash:0,preTaxNwcMovement:0,
     taxableIncome:null,taxableIncomeStatus:"incomplete",
     taxExpenseEligibility:"unreviewed",
     sourceStatus:"auditOnly"
   });
   return rows.get(key);
 };
 for(const unit of unitResults){
   if(unit.status!=="computed")throw new RangeError("unit accounting incomplete");
   if(!statuses.has(unit.entityId))throw new RangeError("unit tax entity missing");
   const e=statuses.get(unit.entityId);
   if((e.taxYearStartMonth??1)!==1)
     throw new RangeError("non-January tax year needs specialized fiscal conversion");
   for(const op of unit.operating){
     const key=unit.unitId+"|"+op.month;
     if(seen.has(key))throw new RangeError("duplicate unit-month economic recognition");
     seen.add(key);
     const r=op.result;
     if(r?.status!=="computed")throw new RangeError("monthly operating result unresolved");
     const row=line(unit.entityId,Number(op.month.slice(0,4)));
     row.lodgingRevenue+=numeric(r.lodging.revenue,"lodging revenue");
     row.rentalRevenue+=numeric(r.rental.revenue,"rental revenue");
     row.lodgingOperatingExpense+=numeric(r.expenses.lodgingOperating,"lodging operating expense");
     row.rentalOperatingExpense+=numeric(r.expenses.rentalOperating,"rental operating expense");
     row.propertyOperatingExpense+=numeric(r.expenses.propertyOperating,"property operating expense");
     row.masterRentExpense+=numeric(r.expenses.masterRent,"master rent expense");
     row.operatingSurplus+=numeric(r.operatingSurplus,"operating surplus");
     row.preTaxNwcMovement+=numeric(r.expenses.deltaOperatingNWC,"NWC");
   }
   for(const event of [...unit.investing,...unit.financing]){
     const row=line(unit.entityId,Number(event.month.slice(0,4)));
     const amount=numeric(event.amount,"cash flow event");
     if(event.kind==="financing"){
       if(event.category==="interest"){if(amount>0)throw new RangeError("interest paid should be negative");row.interestCashPaid-=amount;}
       else if(event.category==="loanDrawdown")row.debtDrawdowns+=amount;
       else if(["scheduledPrincipal","exitDebtPayoff","prepaymentPrincipal"].includes(event.category))row.principalPaid-=amount;
     }else if(event.kind==="investing"){
       if(event.category==="acquisitionPrice")row.purchaseCapitalCash-=amount;
       else if(event.category==="disposalProceeds")row.disposalGrossCash+=amount;
       else if(event.category.endsWith("CapEx"))row.capitalExpenditureCash-=amount;
     }
   }
 }
 const result=[...rows.values()].sort((a,b)=>a.taxYear-b.taxYear||a.entityId.localeCompare(b.entityId));
 for(const r of result){
   const reconcile=r.lodgingRevenue+r.rentalRevenue-
      r.lodgingOperatingExpense-r.rentalOperatingExpense-
      r.propertyOperatingExpense-r.masterRentExpense-r.operatingSurplus;
   if(Math.abs(reconcile)>Math.max(1e-6,(r.lodgingRevenue+r.rentalRevenue)*1e-10))
      throw new RangeError("tax source crosswalk operating reconciliation failed");
   r.revenueGrossForTaxReview=r.lodgingRevenue+r.rentalRevenue;
   r.cashOperatingExpenseForReview=sum([r.lodgingOperatingExpense,r.rentalOperatingExpense,
     r.propertyOperatingExpense,r.masterRentExpense]);
   r.operatingReconciliationDifference=reconcile;
   r.requires=[
     "Confirm individual income category and private-use allocations",
     "Confirm VAT taxable/exempt transaction classifications and invoices",
     "Apply depreciation and noncash adjustments from reviewed asset tax ledgers",
     "Review interest deductibility and loan/entity allocation",
     "Reconcile exit gain tax, restricted cash, separate capital asset basis and tax payment months"
   ];
 }
 return {status:"auditOnly",rows:result,
   legalTaxableIncome:null,
   warning:"Operating figures reconcile but are NOT taxable income; sale proceeds, debt draws and principal are not ordinary tax revenue"};
}
