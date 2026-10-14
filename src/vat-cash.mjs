/**
 * Gate A/B: VAT-inclusive transaction cash bridge.
 * Accepts fully classified transaction lines, not assumed VAT from GOP/NOI.
 * Source operating CF must EXCLUDE these same gross cash movements.
 * Never infers VAT recoverability; unknown settlement blocks after-tax CF.
 */
const number=(v,k)=>{if(typeof v!=="number"||!Number.isFinite(v))throw new TypeError(k+" requires finite number");return v};
const money=(v,k)=>{number(v,k);if(v<0)throw new RangeError(k+" must be >= 0");return v};
const ym=v=>{if(typeof v!=="string"||!/^\d{4}-(0[1-9]|1[0-2])$/.test(v))throw new RangeError("month YYYY-MM required");return v};
const text=v=>typeof v==="string"&&v.length>0;
const add=(a,b)=>a+b;
/**
 * lines: [{id,entityId,month,kind:"sale"|"expense"|"capital",
 * netAmount, vatAmount, vatClass, cashGrossAmount}]
 * VAT must be included in cashGrossAmount; optional cross-unit attribution.
 * This module creates external gross receipts/payments, nothing more.
 * Taxes: [{id,entityId,month,kind:"payment"|"refund",amount,refundConfirmed}]
 * Explicit payment and refund cash ONLY; an assessment does not create cash.
 */
export function compileVATInclusiveCash({lines,taxSettlements=[],taxCoverage=[]}){
 if(!Array.isArray(lines)||!Array.isArray(taxSettlements)||!Array.isArray(taxCoverage))throw new TypeError("arrays required");
 const transactionIds=new Set(),settlementIds=new Set(),entities=new Set();
 const out=[],coverage=new Map();
 for(const c of taxCoverage){
   if(!text(c.entityId)||coverage.has(c.entityId))throw new RangeError("duplicate or invalid coverage entity");
   if(!["computed","estimated","incomplete"].includes(c.status))throw new RangeError("invalid coverage status");
   coverage.set(c.entityId,c.status);
 }
 for(const line of lines){
   if(!text(line.id)||transactionIds.has(line.id))throw new RangeError("duplicate/invalid transaction");
   transactionIds.add(line.id);
   if(!text(line.entityId))throw new TypeError("entityId required");
   entities.add(line.entityId);ym(line.month);
   if(!["sale","expense","capital"].includes(line.kind))throw new RangeError("invalid kind");
   if(!["taxable","exempt","outOfScope"].includes(line.vatClass))throw new RangeError("invalid VAT classification");
   const net=money(line.netAmount,"netAmount"),vat=money(line.vatAmount,"vatAmount");
   if(line.vatClass!=="taxable"&&vat!==0)throw new RangeError("VAT on exempt/out-of-scope line");
   const gross=money(line.cashGrossAmount,"cashGrossAmount");
   if(Math.abs(gross-(net+vat))>1e-7)throw new RangeError("gross cash differs from net+VAT");
   const category=line.kind==="capital"?"investing":"operating";
   const amount=line.kind==="sale"?gross:-gross;
   out.push({id:line.id,entityId:line.entityId,month:line.month,kind:category,
     category:line.kind==="sale"?"grossSale":line.kind==="capital"?"grossCapitalSpending":"grossOperatingExpense",
     amount,vatComponent:vat,sourceTransactionId:line.id});
 }
 for(const tax of taxSettlements){
   if(!text(tax.id)||settlementIds.has(tax.id)||transactionIds.has(tax.id))throw new RangeError("duplicate settlement id");
   settlementIds.add(tax.id);
   if(!text(tax.entityId))throw new TypeError("entityId required");
   entities.add(tax.entityId);ym(tax.month);
   if(!["payment","refund"].includes(tax.kind))throw new RangeError("VAT settlement kind");
   const value=money(tax.amount,"tax settlement amount");
   if(tax.kind==="refund"&&tax.refundConfirmed!==true)throw new RangeError("unconfirmed VAT refund");
   out.push({id:tax.id,entityId:tax.entityId,month:tax.month,kind:"operating",
    category:"consumptionTaxSettlement",amount:tax.kind==="payment"?-value:value,
    vatComponent:0,sourceTransactionId:null});
 }
 const incomplete=[...entities].filter(e=>!["computed","estimated"].includes(coverage.get(e)));
 const entityResults=[...entities].sort().map(entityId=>{
   const items=out.filter(x=>x.entityId===entityId);
   return {entityId,items,amount:items.map(x=>x.amount).reduce(add,0),
    status:coverage.get(entityId)??"incomplete"};
 });
 return {entityResults,lines:out,status:incomplete.length?"incomplete":([ ...entities].some(e=>coverage.get(e)==="estimated")?"estimated":"computed"),
   incompleteEntities:incomplete,
   notes:["All amounts VAT inclusive; no net-P/L cash duplicated","VAT assessment is NOT a cash event until paid/refunded"]};
}
/**
 * Attach VAT-inclusive movements only to clean, nonoverlapping pretax ledgers.
 * This is intentionally strict: legacy aggregated operating revenue/expenses
 * cannot be used alongside transaction-detail gross cash without splitting.
 */
export function attachVATCashToEntityLedgers({baseLedgers,vatBridge,provenance}){
 if(!Array.isArray(baseLedgers)||!vatBridge?.entityResults)throw new TypeError("ledgers and VAT bridge required");
 if(provenance!=="netPnlExcludedFromCash")throw new RangeError("explicit cash source isolation required");
 const map=new Map();
 for(const l of baseLedgers){
   if(!text(l.entityId)||map.has(l.entityId)||!Array.isArray(l.ledger?.series))throw new TypeError("bad entity ledger");
   if(l.ledger.series.some(x=>x.vatCashIncluded===true))throw new RangeError("VAT gross cash already included");
   map.set(l.entityId,l.ledger.series.map(x=>({...x})));
 }
 for(const e of vatBridge.entityResults){
   if(e.status==="incomplete")throw new RangeError("VAT assessment/settlement coverage incomplete for "+e.entityId);
   if(!map.has(e.entityId))throw new RangeError("VAT entity missing from base ledgers");
   const series=map.get(e.entityId),byMonth=new Map(series.map(x=>[x.month,x]));
   if(byMonth.size!==series.length)throw new RangeError("duplicate base monthly entries");
   for(const tx of e.items){
     const r=byMonth.get(tx.month)??{month:tx.month,operating:0,investing:0,financing:0,pretaxEquityCF:0};
     for(const k of ["operating","investing","financing","pretaxEquityCF"])number(r[k],k);
     r[tx.kind]+=tx.amount;
     r.pretaxEquityCF+=tx.amount;
     r.vatCashIncluded=true;byMonth.set(tx.month,r);
   }
   map.set(e.entityId,[...byMonth.values()].sort((a,b)=>a.month.localeCompare(b.month)));
 }
 return [...map.entries()].map(([entityId,series])=>({entityId,ledger:{series}}));
}
