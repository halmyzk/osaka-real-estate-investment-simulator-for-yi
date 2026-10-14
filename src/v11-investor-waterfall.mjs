/**
 * Investor cash flow WATERFALL (JPY), independent reconciliation of
 * the v1.1 preview result back to dated native unit event categories.
 *
 * No inferred tax refund, sale profit, annual CF0 duplication or
 * user-specific filing rules. Principal and interest remain FinCF,
 * depreciation is excluded as NONCASH. Tax settlement after disposal stays
 * in subsequent annual rows. Initial acquisition/drawdown/initial CapEx
 * in the first valuation month is CF0; first-year sale/debt repayment is not.
 */
const keys=[
 "lodgingRevenue","rentalRevenue","operatingCashExpense",
 "workingCapital","maintenanceCapital",
 "acquisition","closingCosts","renovationCapEx","grossDisposal",
 "sellingAndExitCosts","depositChange","otherInvesting",
 "loanDrawdown","scheduledPrincipal","earlyAndExitPrincipal",
 "interest","financingFees","otherFinancing",
 "VATCash","incomeTaxCash"
];
export const v11InvestorWaterfallFields=Object.freeze([...keys]);
const preKeys=keys.filter(x=>!["VATCash","incomeTaxCash"].includes(x));
const sum=xs=>xs.reduce((a,b)=>a+b,0);
const num=(v,k)=>{if(typeof v!=="number"||!Number.isFinite(v))throw new RangeError(k+" must be a finite amount");return v;};
const approx=(a,b)=>Math.abs(a-b)<=Math.max(1e-5,Math.abs(b)*1e-9);
const id=s=>{if(typeof s!=="string"||!s)throw new TypeError("Missing ID");return s};
const index=s=>Number(s.slice(0,4))*12+Number(s.slice(5,7))-1;
const make=(year,label)=>Object.fromEntries([
 ["year",year],["label",label],...keys.map(k=>[k,0])
]);
const incoming={
 "acquisitionPrice":"acquisition",
 "closingCosts":"closingCosts",
 "initialCapEx":"renovationCapEx",
 "expansionCapEx":"renovationCapEx",
 "maintenanceCapEx":"maintenanceCapital",
 "disposalProceeds":"grossDisposal",
 "saleCosts":"sellingAndExitCosts",
 "exitObligations":"sellingAndExitCosts",
 "refundableDeposit":"depositChange",
 "depositForfeiture":"depositChange",
 "restrictedCashChange":"otherInvesting"
};
const financing={
 "loanDrawdown":"loanDrawdown",
 "scheduledPrincipal":"scheduledPrincipal",
 "prepaymentPrincipal":"earlyAndExitPrincipal",
 "exitDebtPayoff":"earlyAndExitPrincipal",
 "interest":"interest",
 "financingFee":"financingFees",
 "prepaymentFee":"financingFees"
};
function add(row,field,value){
 row[field]+=num(value,field);
}
function finalize(row){
 row.operatingNet=row.lodgingRevenue+row.rentalRevenue+row.operatingCashExpense+row.workingCapital;
 row.investingNet=row.acquisition+row.closingCosts+row.maintenanceCapital+
   row.renovationCapEx+row.grossDisposal+row.sellingAndExitCosts+
   row.depositChange+row.otherInvesting;
 row.financingNet=row.loanDrawdown+row.scheduledPrincipal+
   row.earlyAndExitPrincipal+row.interest+row.financingFees+row.otherFinancing;
 row.preTaxEquityCF=row.operatingNet+row.investingNet+row.financingNet;
 row.indicativeEquityCF=row.preTaxEquityCF+row.VATCash+row.incomeTaxCash;
 return row;
}
export function buildV11InvestorWaterfall({document,preview}){
 if(document?.schemaVersion!=="1.1.0"||preview?.status!=="estimated-pre-tax"||
    !Array.isArray(preview.units)||!Array.isArray(preview.annual))
  throw new TypeError("Computed v1.1 preview and source document required");
 const firstMonth=document.portfolio.baseDate.slice(0,7),
 baseYear=Number(firstMonth.slice(0,4));
 const initial=make(null,"初期 CF₀");
 const rows=new Map();
 const yearRow=y=>{
  if(y<baseYear)throw new RangeError("Cash before valuation year cannot be annual");
  if(!rows.has(y))rows.set(y,make(y,String(y)));
  return rows.get(y);
 };
 const isInitial=e=>e.month===firstMonth&&(
  e.kind==="investing"&&
    (["acquisitionPrice","closingCosts","initialCapEx"].includes(e.category)||
     (e.category==="refundableDeposit"&&e.amount<0))||
  e.kind==="financing"&&["loanDrawdown","financingFee"].includes(e.category)
 );
 const units=[];
 for(const u of preview.units){
  if(u.status!=="computed")throw new RangeError("Uncomputed unit");
  let revenue=0,acquisition=0,disposal=0,principalPaid=0,interestPaid=0;
  const allMonths=new Set();
  for(const o of u.operating){
   if(allMonths.has(o.month))throw new RangeError("Duplicate operating month");
   allMonths.add(o.month);
   const r=o.result;
   const row=yearRow(Number(o.month.slice(0,4)));
   const lodging=num(r.lodging.revenue,"lodging cash"),rental=num(r.rental.revenue,"rental cash");
   const surplus=num(r.operatingSurplus,"operating surplus");
   revenue+=lodging+rental;
   add(row,"lodgingRevenue",lodging);
   add(row,"rentalRevenue",rental);
   add(row,"operatingCashExpense",surplus-lodging-rental);
   add(row,"workingCapital",-num(r.expenses.deltaOperatingNWC,"operating NWC"));
   add(row,"maintenanceCapital",-num(r.expenses.maintenanceCapEx,"maintenance CapEx"));
  }
  for(const [kind,events] of [["investing",u.investing],["financing",u.financing]]){
   for(const e of events){
    if(e.kind!==kind)throw new RangeError("Mismatched event kind");
    const row=isInitial(e)?initial:yearRow(Number(e.month.slice(0,4)));
    const field=(kind==="investing"?incoming:financing)[e.category];
    if(!field)throw new RangeError("Unknown dated cash event category "+e.category);
    add(row,field,e.amount);
    if(e.category==="acquisitionPrice")acquisition+=-e.amount;
    if(e.category==="disposalProceeds")disposal+=e.amount;
    if(["scheduledPrincipal","prepaymentPrincipal","exitDebtPayoff"].includes(e.category))
      principalPaid+=-e.amount;
    if(e.category==="interest")interestPaid+=-e.amount;
   }
  }
  units.push({unitId:u.unitId,entityId:u.entityId,
    revenue,acquisitionCash:acquisition,grossSaleCash:disposal,
    principalPaid,interestPaid});
 }
 const approximate=preview.indicativeAfterTax!==null;
 if(approximate){
  for(const e of preview.indicativeVATCashAdjustments??[])
   add(yearRow(Number(e.month.slice(0,4))),"VATCash",e.operating);
  for(const e of preview.indicativeIncomeTaxCashEvents??[])
   add(yearRow(Number(e.month.slice(0,4))),"incomeTaxCash",e.incrementalTaxCF);
 }
 finalize(initial);
 if(!approx(initial.preTaxEquityCF,preview.CF0))
  throw new RangeError("CF0 waterfall differs from initial equity");
 const maxYear=Math.max(baseYear+document.portfolio.holdingYears-1,
    ...preview.annual.map(r=>r.year),...rows.keys());
 let cumulative=initial.preTaxEquityCF;
 let afterCumulative=initial.indicativeEquityCF;
 let minCum=cumulative;
 const annual=[];
 const originals=new Map(preview.annual.map(x=>[x.year,x]));
 const indicative=new Map((preview.annualIndicativeCashFlows??[]).map(x=>[x.year,x]));
 for(let year=baseYear;year<=maxYear;year++){
  const row=finalize(rows.get(year)??make(year,String(year)));
  const original=originals.get(year);
  if(original){
   if(!approx(row.operatingNet,original.operating)||
     !approx(row.investingNet,original.investing)||
     !approx(row.financingNet,original.financing)||
     !approx(row.preTaxEquityCF,original.preTaxEquityCF))
     throw new RangeError("Annual base ledger cash does not reconcile: "+year);
  }else if(!approx(row.preTaxEquityCF,0))
   throw new RangeError("Preview missing year with investment/operating cash");
  const estimated=indicative.get(year);
  if(approximate&&estimated&&!approx(row.indicativeEquityCF,estimated.indicativeAfterTaxEquityCF))
   throw new RangeError("VAT/income tax waterfall does not reconcile: "+year);
  cumulative+=row.preTaxEquityCF;
  afterCumulative+=row.indicativeEquityCF;
  row.cumulativePreTaxEquityCF=cumulative;
  row.cumulativeIndicativeEquityCF=approximate?afterCumulative:null;
  minCum=Math.min(minCum,approximate?afterCumulative:cumulative);
  annual.push(row);
 }
 const total=finalize(make(null,"全期間合計"));
 for(const r of [initial,...annual])
   for(const k of keys)add(total,k,r[k]);
 finalize(total);
 const cashSeries=preview.preTax?.cashFlows??[];
 // Pre-tax portfolio evaluation intentionally stops at the contracted
 // investment horizon. The indicative assessment adds later years when
 // taxes are paid after the sale. In those later years pre-tax flow is zero,
 // so extend the input reference with zeros instead of duplicating exit cash.
 if(!cashSeries.length||cashSeries.length>annual.length+1||
   !approx(total.preTaxEquityCF,sum(cashSeries))||
   cashSeries.slice(1).some((value,i)=>!approx(value,annual[i].preTaxEquityCF))||
   annual.slice(cashSeries.length-1).some(r=>!approx(r.preTaxEquityCF,0)))
   throw new RangeError("Total pre-tax portfolio waterfall does not reconcile");
 if(approximate){
  if(preview.indicativeAfterTax.cashFlows.length!==annual.length+1||
    !approx(total.indicativeEquityCF,sum(preview.indicativeAfterTax.cashFlows)))
    throw new RangeError("Total indicative equity waterfall does not reconcile");
 }
 const acquisitionTotal=sum(units.map(x=>x.acquisitionCash));
 const debtDraw=sum([initial,...annual].map(x=>x.loanDrawdown));
 const debtRepay=-sum([initial,...annual].map(x=>x.scheduledPrincipal+x.earlyAndExitPrincipal));
 return {status:approximate?"estimated":"preTaxOnly",
  initial,annual,total,units,
  metrics:{
   initialEquityCF:initial.preTaxEquityCF,
   acquisitionTotal,
   grossDisposalTotal:sum(units.map(x=>x.grossSaleCash)),
   loanDrawdownTotal:debtDraw,
   principalRepaidTotal:debtRepay,
   cashInterestPaidTotal:-total.interest,
   cashTaxPaidTotal:approximate?-total.incomeTaxCash:null,
   netVATCashTotal:approximate?total.VATCash:null,
   indicativeNetProfit:approximate?total.indicativeEquityCF:null,
   annualYearEndMaxFundingNeed:Math.max(0,-minCum),
   closingLoanBalanceByCash:debtDraw-debtRepay,
   annualizedNPV:approximate?preview.indicativeAfterTax.NPV:null,
   annualizedIRR:approximate?preview.indicativeAfterTax.IRR:null
  },
  notes:[
   "Initial CF0 is separated from year 1 even when acquisition and disposition share a calendar month",
   "Scheduled and early/exit principal payments are financing CF; not operating cost or depreciation",
   "VAT cash and income taxes appear in the actual assumed payment years, including after disposal",
   "Maximum funding need is observed only at CF0 and YEAR END, not all monthly cash lows",
   "Debt closing balance is cash ledger derived and assumes no outstanding unsupported debt events",
   "Indicative investment totals rely on explicit approximate tax/VAT assumptions, not filing-accurate tax"
  ]};
}
