/**
 * Gate A/B portfolio aggregation and annual investment appraisal.
 * Inputs must already have passed per-unit operating, finance and tax rules.
 *
 * Common calendar year, explicit t=0 cash, and cash tax *payment* month.
 * All entity ledgers are external economic cash flows plus disclosed internal
 * transfers. Paired intra-portfolio transfers must cancel, not be dropped
 * from entity tax bases. A missing entity tax assessment blocks after-tax KPIs.
 */
const number=(x,k)=>{
  if(typeof x!=="number"||!Number.isFinite(x))throw new TypeError(k+" must be finite number");
  return x;
};
const id=(x,k)=>{if(typeof x!=="string"||!x)throw new TypeError(k+" must be a nonempty string");return x;};
const month=(x)=>{if(typeof x!=="string"||!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(x))throw new RangeError("expected YYYY-MM");return x;};
const add=(a,b)=>a+b;
const SUM=a=>a.reduce(add,0);
const tolerance=(a,b)=>Math.abs(a-b)<=Math.max(1e-6,1e-10*Math.max(Math.abs(a),Math.abs(b)));

export function aggregateTaxableCategories(entries){
  if(!Array.isArray(entries))throw new TypeError("entries required");
  const grouped=new Map();
  for(const x of entries){
    id(x.entityId,"entityId");id(x.category,"category");
    if(!Number.isInteger(x.taxYear)||x.taxYear<1900)throw new RangeError("invalid tax year");
    if(!["business","miscellaneous","realEstate","corporate"].includes(x.category))throw new RangeError("invalid category");
    if(!["revenue","deductibleExpense","depreciation","adjustment"].includes(x.kind))throw new RangeError("invalid kind");
    const value=number(x.amount,"tax item amount");
    if(x.kind!=="adjustment"&&value<0)throw new RangeError("non-adjustment must be >=0");
    const key=[x.entityId,x.taxYear,x.category].join("|");
    let g=grouped.get(key);
    if(!g){g={entityId:x.entityId,taxYear:x.taxYear,category:x.category,revenue:0,deductibleExpense:0,depreciation:0,adjustment:0};grouped.set(key,g);}
    g[x.kind]+=value;
  }
  const rows=[...grouped.values()].map(x=>({...x,taxableCategoryProfit:x.revenue-x.deductibleExpense-x.depreciation+x.adjustment}));
  return rows.sort((a,b)=>a.entityId.localeCompare(b.entityId)||a.taxYear-b.taxYear||a.category.localeCompare(b.category));
}

function rootsOfAnnualCF(flows){
  // Search in log(1+r) avoids numerical instability near -100%.
  // A root of even multiplicity can be missed; warn on nonconventional
  // cash-flow signs rather than presenting one IRR as unique.
  const signChanges=flows.reduce((acc,x,i)=>{
    if(!x)return acc;
    const previous=flows.slice(0,i).findLast(v=>v!==0);
    return acc+(previous!==undefined&&Math.sign(previous)!==Math.sign(x)?1:0);
  },0);
  if(flows[0]>=0||!flows.some(x=>x>0))return {status:"notApplicable",IRR:null,roots:[],signChanges,reason:"Invalid investment sign pattern"};
  const valueAt=logGrowth=>{
    const q=Math.exp(-logGrowth);
    let factor=1,total=0;
    for(const cf of flows){total+=cf*factor;factor*=q;}
    return total;
  };
  // -0.999999 < r < exp(12)-1, with robust bisection of sign-changing roots.
  const roots=[];let previousLog=-12, previousV=valueAt(previousLog);
  for(let step=1;step<=2400;step++){
    const logR=-12+step*.01,v=valueAt(logR);
    if(Math.sign(v)!==Math.sign(previousV)){
      let lo=previousLog,hi=logR,fl=previousV;
      for(let it=0;it<90;it++){
        const mid=(lo+hi)/2, fm=valueAt(mid);
        if(Math.sign(fm)===Math.sign(fl)){lo=mid;fl=fm;}else hi=mid;
      }
      const root=Math.expm1((lo+hi)/2);
      if(Number.isFinite(root)&&roots.every(y=>Math.abs(y-root)>1e-8))roots.push(root);
    }
    previousLog=logR;previousV=v;
  }
  if(signChanges>1)return {status:"ambiguous",IRR:null,roots,signChanges,reason:"Nonconventional cash-flow signs: multiple or tangent IRRs possible"};
  if(roots.length!==1)return {status:"notCalculable",IRR:null,roots,signChanges,reason:"No unique IRR root found in configured range"};
  return {status:"computed",IRR:roots[0],roots,signChanges};
}
export function evaluateAnnualCashFlows({cashFlows,discountRate=null}){
 if(!Array.isArray(cashFlows)||cashFlows.length<2)throw new TypeError("cashFlows must include CF0 and at least one year");
 cashFlows.forEach((x,i)=>number(x,"CF["+i+"]"));
 const irr=rootsOfAnnualCF(cashFlows);
 if(discountRate===null)return {IRR:irr.IRR,irrStatus:irr.status,irrDetails:irr,NPV:null,npvStatus:"incomplete"};
 number(discountRate,"discountRate");
 if(discountRate<=-1)throw new RangeError("discount rate must exceed -100%");
 let npv=0;
 for(let y=0;y<cashFlows.length;y++)npv+=cashFlows[y]/Math.pow(1+discountRate,y);
 return {IRR:irr.IRR,irrStatus:irr.status,irrDetails:irr,NPV:npv,npvStatus:"computed"};
}
/**
 * entityLedgers: [{entityId, ledger:{series:[{month,operating,investing,financing,pretaxEquityCF}]}}]
 * timeZero: [{entityId, amount}], classified explicitly as CF0 and NOT repeated in ledgers.
 * taxes: incrementalTaxEvents(...).entries (entity/month/incrementalTaxCF).
 * internalTransfers: [{id,month,fromEntityId,toEntityId,amount}], already booked
 *     within entity ledger cash flow; validates opposite paired effects.
 * taxCoverage: [{entityId,status:"computed"|"estimated"|"incomplete"}].
 * Unknown taxes produce no after-tax IRR/NPV, never silently 0.
 */
export function evaluatePortfolio({
 entityLedgers, timeZero=[], taxes=[], taxCoverage=[],
 internalTransfers=[], baseCalendarYear, holdingYears, discountRate=null
}){
 if(!Number.isInteger(baseCalendarYear)||baseCalendarYear<1900)throw new RangeError("baseCalendarYear required");
 if(!Number.isInteger(holdingYears)||holdingYears<1)throw new RangeError("holdingYears required");
 for(const [k,a] of Object.entries({entityLedgers,timeZero,taxes,taxCoverage,internalTransfers}))
   if(!Array.isArray(a))throw new TypeError(k+" array required");
 const entities=new Set(),months=new Map(),taxByMonth=new Map(),atZero=new Map();
 for(const e of entityLedgers){
   const entityId=id(e.entityId,"entityId");
   if(entities.has(entityId))throw new RangeError("duplicate entity ledger "+entityId);
   entities.add(entityId);
   if(!Array.isArray(e.ledger?.series))throw new TypeError("entity ledger series required");
   const encountered=new Set();
   for(const r of e.ledger.series){
     month(r.month);if(encountered.has(r.month))throw new RangeError("duplicate month in entity ledger");
     encountered.add(r.month);
     const operating=number(r.operating,"OCF"),investing=number(r.investing,"ICF"),financing=number(r.financing,"FinCF");
     const pretax=number(r.pretaxEquityCF,"pretaxEquityCF");
     if(!tolerance(operating+investing+financing,pretax))throw new RangeError("entity cash reconciliation failed");
     if(Number(r.month.slice(0,4))<baseCalendarYear)throw new RangeError("pre-valuation cash belongs in explicit CF0");
     const k=entityId+"|"+r.month;
     months.set(k,{entityId,month:r.month,operating,investing,financing,pretaxEquityCF:pretax});
   }
 }
 for(const x of timeZero){
   if(!entities.has(x.entityId))throw new RangeError("unknown CF0 entity");
   atZero.set(x.entityId,(atZero.get(x.entityId)??0)+number(x.amount,"CF0 amount"));
 }
 const status=new Map();
 for(const c of taxCoverage){
   if(!entities.has(c.entityId)||status.has(c.entityId))throw new RangeError("bad/duplicate tax coverage entity");
   if(!["computed","estimated","incomplete"].includes(c.status))throw new RangeError("tax coverage status");
   status.set(c.entityId,c.status);
 }
 const taxComplete=[...entities].every(e=>["computed","estimated"].includes(status.get(e)));
 const allTaxKeys=new Set();
 for(const t of taxes){
   if(!entities.has(t.entityId))throw new RangeError("tax cash event entity missing from portfolio");
   month(t.month);
   const value=number(t.incrementalTaxCF,"incrementalTaxCF");
   const key=t.entityId+"|"+t.month+"|"+String(t.taxKind??"income");
   if(allTaxKeys.has(key))throw new RangeError("duplicate tax event: aggregate tax kind per entity/month");
   allTaxKeys.add(key);
   taxByMonth.set(t.entityId+"|"+t.month,(taxByMonth.get(t.entityId+"|"+t.month)??0)+value);
 }
 // Internal transactions are already in both entity ledgers; validate instead
 // of adding them or subtracting again (would be double elimination).
 const transferIds=new Set();
 for(const t of internalTransfers){
   id(t.id,"transfer id");month(t.month);
   if(transferIds.has(t.id))throw new RangeError("duplicate internal transfer");
   transferIds.add(t.id);
   if(!entities.has(t.fromEntityId)||!entities.has(t.toEntityId)||t.fromEntityId===t.toEntityId)
     throw new RangeError("internal transfer must be between included distinct entities");
   const v=number(t.amount,"transfer amount");
   if(v<0)throw new RangeError("transfer amount cannot be negative");
   // Caller presents isolated paired transaction evidence, not unverifiable aggregates.
   if(!t.fromLedgerAmount||!t.toLedgerAmount)
     throw new RangeError("explicit mirrored internal transfer ledger amounts required");
   if(!tolerance(number(t.fromLedgerAmount,"from amount"),-v)||!tolerance(number(t.toLedgerAmount,"to amount"),v))
     throw new RangeError("internal transfers are not mirrored");
 }
 const byYear=new Map();
 const addYear=(year,field,value)=>{
   const line=byYear.get(year)??{year,operating:0,investing:0,financing:0,preTaxEquityCF:0,taxCashFlow:0,afterTaxEquityCF:0};
   line[field]+=value;byYear.set(year,line);
 };
 for(const item of months.values()){
   const y=Number(item.month.slice(0,4));
   for(const [field,value] of [["operating",item.operating],["investing",item.investing],["financing",item.financing],["preTaxEquityCF",item.pretaxEquityCF]])addYear(y,field,value);
 }
 for(const [key,value] of taxByMonth){
   const mo=key.split("|")[1];const y=Number(mo.slice(0,4));
   if(y<baseCalendarYear)throw new RangeError("tax before base year must be in CF0");
   addYear(y,"taxCashFlow",value);
 }
 const last=Math.max(baseCalendarYear+holdingYears-1,...byYear.keys());
 const annual=[];
 for(let y=baseCalendarYear;y<=last;y++){
   const a=byYear.get(y)??{year:y,operating:0,investing:0,financing:0,preTaxEquityCF:0,taxCashFlow:0,afterTaxEquityCF:0};
   a.afterTaxEquityCF=a.preTaxEquityCF+a.taxCashFlow;
   annual.push(a);
 }
 const CF0=SUM([...atZero.values()]);
 const preFlows=[CF0,...annual.map(x=>x.preTaxEquityCF)];
 const afterFlows=[CF0,...annual.map(x=>x.afterTaxEquityCF)];
 const pre=evaluateAnnualCashFlows({cashFlows:preFlows,discountRate});
 const after=taxComplete?evaluateAnnualCashFlows({cashFlows:afterFlows,discountRate}):null;
 return {baseCalendarYear,holdingYears,yearEndApproximation:true,
   annual,CF0,preTax:{cashFlows:preFlows,...pre},
   afterTax:after?{cashFlows:afterFlows,...after}:{cashFlows:null,NPV:null,IRR:null,npvStatus:"incomplete",irrStatus:"incomplete"},
   taxStatus:taxComplete?([...status.values()].includes("estimated")?"estimated":"computed"):"incomplete",
   reconciliation:{preTaxTotal:CF0+SUM(annual.map(x=>x.preTaxEquityCF)),
     taxCashFlowTotal:SUM(annual.map(x=>x.taxCashFlow)),
     afterTaxTotal:taxComplete?CF0+SUM(annual.map(x=>x.afterTaxEquityCF)):null},
   notes:["Entity tax calculations remain separate; internal transfers are mirrored, not economically doubled",
     "Cash flow years are common calendar years, with independently specified CF0",
     "Unlevered after-tax valuation requires a separate no-debt tax recalculation"]};
}
