/**
 * Gate A §13.4–13.8: pre-tax cash ledger and amortization.
 * No tax effects, VAT settlement, IRR or investor distributions here.
 * Money is nominal JPY. All events attach to common YYYY-MM months.
 *
 * Month composition: OCF = operatingSurplus - deltaOperatingNWC
 *                  ICF = -maintenanceCapEx + investing events
 *                  FinCF = debt events
 * preTaxCFADS = operatingSurplus - maintenanceCapEx - deltaOperatingNWC
 * Therefore OCF + ICF + FinCF = preTaxCFADS + financing CF
 * for a month with no other investing event.
 */
const num=(x,k,{min=-Infinity,max=Infinity}={})=>{
  if(typeof x!=="number"||!Number.isFinite(x)||x<min||x>max)throw new RangeError(`${k}: finite number required in [${min},${max}]`);
  return x;
};
const nonneg=(x,k)=>num(x,k,{min:0});
const sum=items=>items.reduce((a,b)=>a+b,0);
const zero=()=>({operating:0,investing:0,financing:0});
const monthKey=(s)=>{
  if(typeof s!=="string"||!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(s))throw new RangeError("month must be YYYY-MM");
  return s;
};
const pad=n=>String(n).padStart(2,"0");
const monthAdd=(base,offset)=>{
  monthKey(base);
  if(!Number.isInteger(offset))throw new RangeError("offset must be integer");
  const [year,month]=base.split("-").map(Number);
  const index=year*12+month-1+offset;
  if(index<12)throw new RangeError("month outside supported range");
  return `${Math.floor(index/12)}-${pad(index%12+1)}`;
};
const record=(kind,month,category,amount,reference)=>({kind,month:monthKey(month),category,amount:num(amount,"amount"),reference});
const requireRecords=(arr,k)=>{
  if(!Array.isArray(arr))throw new TypeError(`${k} must be an array`);
  const ids=new Set();
  for(const r of arr){
    if(!r || typeof r!=="object"||typeof r.id!=="string"||!r.id)throw new TypeError(`${k}: event id required`);
    if(ids.has(r.id))throw new RangeError(`${k}: duplicate id ${r.id}`);
    ids.add(r.id); monthKey(r.month);
  }
};
export function debtAmortization({
  loanId,drawMonth,principal,annualInterestRate,termMonths,
  repaymentMethod="annuity",prepayments=[]
}){
  if(typeof loanId!=="string"||!loanId)throw new TypeError("loanId required");
  monthKey(drawMonth);
  nonneg(principal,"principal");
  nonneg(annualInterestRate,"annualInterestRate"); // decimal: 0.045 == 4.5%
  if(!Number.isInteger(termMonths)||termMonths<=0)throw new RangeError("termMonths must be positive integer");
  if(!["annuity","equalPrincipal","bullet"].includes(repaymentMethod))throw new RangeError("unsupported repayment method");
  if(!Array.isArray(prepayments))throw new TypeError("prepayments array required");
  const pp=new Map();
  for(const p of prepayments){
    if(!Number.isInteger(p.monthIndex)||p.monthIndex<1||p.monthIndex>termMonths||pp.has(p.monthIndex))throw new RangeError("invalid/duplicate prepayment index");
    pp.set(p.monthIndex,{amount:nonneg(p.amount,"prepayment amount"),fee:nonneg(p.fee??0,"prepayment fee")});
  }
  const paymentRecords=[];
  const monthlyRate=annualInterestRate/12;
  let balance=principal, remaining=termMonths;
  for(let i=1;i<=termMonths;i++){
    const month=monthAdd(drawMonth,i);
    if(balance<=1e-8){balance=0;break}
    const interest=balance*monthlyRate;
    let scheduledPrincipal=0;
    if(repaymentMethod==="bullet"){
      scheduledPrincipal=i===termMonths?balance:0;
    }else if(repaymentMethod==="equalPrincipal"){
      scheduledPrincipal=balance/remaining;
    }else{
      const debtService=monthlyRate===0?balance/remaining:balance*monthlyRate/(1-Math.pow(1+monthlyRate,-remaining));
      scheduledPrincipal=Math.min(balance,Math.max(0,debtService-interest));
    }
    scheduledPrincipal=Math.min(balance,scheduledPrincipal);
    balance-=scheduledPrincipal;
    const pre=pp.get(i)??{amount:0,fee:0};
    const extra=Math.min(balance,pre.amount);
    if(pre.amount>balance+1e-6)throw new RangeError("prepayment greater than outstanding principal");
    balance-=extra;
    const fee=extra>0?pre.fee:0;
    if(i===termMonths&&Math.abs(balance)<1e-6)balance=0;
    paymentRecords.push({month,monthIndex:i,openingBalance:balance+scheduledPrincipal+extra,
      scheduledPrincipal,interest,prepayment:extra,prepaymentFee:fee,
      closingBalance:balance,
      scheduledDebtService:scheduledPrincipal+interest});
    remaining--;
  }
  return {
    loanId,drawMonth,principal,paymentRecords,
    contractualFinalBalance:balance,
    scheduledDebtService:sum(paymentRecords.map(r=>r.scheduledDebtService)),
    totalInterest:sum(paymentRecords.map(r=>r.interest))
  };
}

/** Events use signed external cash flow. For a loan, use positive draw and negative payment events. */
export function ledgerFromLoan({loanId,drawMonth,principal,annualInterestRate,termMonths,repaymentMethod,prepayments=[],originationFee=0},exitMonth=null){
  nonneg(originationFee,"originationFee");
  const schedule=debtAmortization({loanId,drawMonth,principal,annualInterestRate,termMonths,repaymentMethod,prepayments});
  const events=[];
  if(exitMonth!==null){monthKey(exitMonth);if(exitMonth<drawMonth)throw new RangeError("exit predates draw");}
  if(principal>0)events.push(record("financing",drawMonth,"loanDrawdown",principal,loanId));
  if(originationFee>0)events.push(record("financing",drawMonth,"financingFee",-originationFee,loanId));
  let outstanding=principal;
  for(const pay of schedule.paymentRecords){
    if(exitMonth!==null && pay.month>exitMonth)break;
    // If sale takes place at month-end, scheduled debt service happens before sale payoff.
    for(const [cat,value] of [["scheduledPrincipal",pay.scheduledPrincipal],["interest",pay.interest],["prepaymentPrincipal",pay.prepayment],["prepaymentFee",pay.prepaymentFee]]){
      if(value!==0)events.push(record("financing",pay.month,cat,-value,loanId));
    }
    outstanding=pay.closingBalance;
  }
  if(exitMonth!==null && outstanding>1e-8){
    events.push(record("financing",exitMonth,"exitDebtPayoff",-outstanding,loanId));
    outstanding=0;
  }
  return {events,schedule,closingBalance:outstanding};
}

/**
 * External investing transactions only; profit on sale is NOT tax-calculated.
 * For refundable deposits: deposit paid = cash out, deposit recovered = cash in.
 * A planning-only unrestricted liquidity reserve is excluded.
 */
export function investingEvents({
  acquisitions=[],capitalSpending=[],refundableDeposits=[],disposals=[],restrictedCashChanges=[]
}={}){
  const collections={acquisitions,capitalSpending,refundableDeposits,disposals,restrictedCashChanges};
  for(const [name,list] of Object.entries(collections))requireRecords(list,name);
  const globalIds=new Set(),events=[];
  const make=(list,fn)=>{
    for(const e of list){
      if(globalIds.has(e.id))throw new RangeError("duplicate investing transaction id");
      globalIds.add(e.id);fn(e);
    }
  };
  make(acquisitions,e=>{
    events.push(record("investing",e.month,"acquisitionPrice",-nonneg(e.price,"acquisition price"),e.id));
    if(e.closingCosts!==undefined && e.closingCosts!==0)events.push(record("investing",e.month,"closingCosts",-nonneg(e.closingCosts,"closing costs"),e.id));
  });
  make(capitalSpending,e=>{
    if(!["initial","expansion","maintenance"].includes(e.purpose))throw new RangeError("invalid CapEx purpose");
    events.push(record("investing",e.month,e.purpose+"CapEx",-nonneg(e.amount,"CapEx amount"),e.id));
  });
  make(refundableDeposits,e=>{
    if(!["paid","refunded","forfeited"].includes(e.action))throw new RangeError("deposit action invalid");
    const sign=e.action==="refunded"?1:-1;
    events.push(record("investing",e.month,e.action==="forfeited"?"depositForfeiture":"refundableDeposit",sign*nonneg(e.amount,"deposit"),e.id));
  });
  make(disposals,e=>{
    events.push(record("investing",e.month,"disposalProceeds",nonneg(e.proceeds,"disposal proceeds"),e.id));
    for(const [key,category] of [["sellingCosts","saleCosts"],["exitObligations","exitObligations"]]){
      const amount=nonneg(e[key]??0,key);
      if(amount>0)events.push(record("investing",e.month,category,-amount,e.id));
    }
  });
  make(restrictedCashChanges,e=>{
    events.push(record("investing",e.month,"restrictedCashChange",-num(e.delta,"restricted cash delta"),e.id));
  });
  return events;
}

/**
 * Merge independently calculated operating results and dated ledger events.
 * Operating result already includes maintenanceCapEx within preTaxCFADS;
 * it must not be passed again in capitalSpending.
 * Also excludes income tax and VAT settlement (next Gate B step).
 */
export function compilePretaxLedger({operatingMonths=[],investing=[],financing=[]}){
  if(!Array.isArray(operatingMonths)||!Array.isArray(investing)||!Array.isArray(financing))throw new TypeError("arrays required");
  const months=new Map(),lines=[];
  const add=(month,kind,category,amount,reference)=>{
    monthKey(month);num(amount,"ledger amount");
    if(!months.has(month))months.set(month,{month,...zero()});
    months.get(month)[kind]+=amount;
    lines.push({month,kind,category,amount,reference});
  };
  const unitMonths=new Set();
  for(const o of operatingMonths){
    if(!o||typeof o.unitId!=="string"||!o.unitId)throw new TypeError("unitId required");
    const month=monthKey(o.month), key=o.unitId+":"+month;
    if(unitMonths.has(key))throw new RangeError("duplicate unit operating month");
    unitMonths.add(key);
    const r=o.result;
    if(r?.status!=="computed")throw new TypeError("computed operating result required");
    for(const k of ["operatingSurplus","preTaxCFADS"])num(r[k],k);
    const delta=num(r.expenses?.deltaOperatingNWC,"deltaOperatingNWC");
    const maintenance=nonneg(r.expenses?.maintenanceCapEx,"maintenanceCapEx");
    const expected=r.operatingSurplus-delta-maintenance;
    if(Math.abs(expected-r.preTaxCFADS)>1e-6)throw new RangeError("CFADS reconciliation failed");
    add(month,"operating","operatingSurplus",r.operatingSurplus,o.unitId);
    add(month,"operating","operatingNWCChange",-delta,o.unitId);
    add(month,"investing","maintenanceCapEx",-maintenance,o.unitId);
  }
  const externallyTracked=new Set();
  for(const [list,kind] of [[investing,"investing"],[financing,"financing"]]){
    for(const event of list){
      if(!event||event.kind!==kind)throw new TypeError("ledger kind mismatch");
      if(typeof event.reference!=="string"||!event.reference)throw new TypeError("event reference required");
      if(kind==="investing"&&event.category==="maintenanceCapEx")throw new RangeError("maintenance CapEx must come from operating result");
      const identity=[kind,event.reference,event.month,event.category].join("|");
      if(externallyTracked.has(identity))throw new RangeError("possible duplicate external event: "+identity);
      externallyTracked.add(identity);
      add(event.month,kind,event.category,event.amount,event.reference);
    }
  }
  const series=[...months.values()].sort((a,b)=>a.month.localeCompare(b.month)).map(x=>({
    ...x,pretaxEquityCF:x.operating+x.investing+x.financing
  }));
  return {
    lines,series,
    totals:{
      OCF:sum(series.map(x=>x.operating)),ICF:sum(series.map(x=>x.investing)),
      FinCF:sum(series.map(x=>x.financing)),pretaxEquityCF:sum(series.map(x=>x.pretaxEquityCF))
    },
    taxStatus:"notImplemented"
  };
}
