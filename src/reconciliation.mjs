/**
 * Gate A/B detailed transaction audit across income-tax entities.
 * Taxable intercompany dealings remain recorded for both entities, while
 * investor-group cash flows count opposite internal payments only once.
 *
 * This audit verifies transaction-level evidence, NOT merely totals.
 */
const finite=(v,k)=>{
 if(typeof v!=="number"||!Number.isFinite(v))throw new TypeError(k+" must be finite");
 return v;
};
const id=(x,k)=>{if(typeof x!=="string"||!x)throw new TypeError(k+" required");return x;};
const period=x=>{if(typeof x!=="string"||!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(x))throw new RangeError("month YYYY-MM");return x;};
const close=(a,b)=>Math.abs(a-b)<=1e-6;
/**
 * ledgerLines: entries booked by legal entity:
 * {id,entityId,month,category,amount,internalTransferId|null}
 * transfers: {id,month,fromEntityId,toEntityId,amount,category}
 * Exact, unique one debit and one credit per transfer are required.
 */
export function auditInterEntityTransfers({ledgerLines,transfers,entityIds}){
 if(!Array.isArray(ledgerLines)||!Array.isArray(transfers)||!Array.isArray(entityIds))throw new TypeError("arrays required");
 const entities=new Set(entityIds.map(v=>id(v,"entityId")));
 if(entities.size!==entityIds.length)throw new RangeError("duplicate legal entity");
 const linesByTransfer=new Map(),lineIds=new Set();
 for(const l of ledgerLines){
   id(l.id,"line id");id(l.entityId,"line entityId");period(l.month);id(l.category,"category");
   finite(l.amount,"line amount");
   if(!entities.has(l.entityId)||lineIds.has(l.id))throw new RangeError("invalid or duplicate ledger line");
   lineIds.add(l.id);
   if(l.internalTransferId){
     id(l.internalTransferId,"transfer reference");
     if(!linesByTransfer.has(l.internalTransferId))linesByTransfer.set(l.internalTransferId,[]);
     linesByTransfer.get(l.internalTransferId).push(l);
   }
 }
 const transferIds=new Set(),proof=[];
 for(const t of transfers){
   id(t.id,"transfer id");id(t.fromEntityId,"fromEntityId");id(t.toEntityId,"toEntityId");
   period(t.month);id(t.category,"category");finite(t.amount,"amount");
   if(t.amount<0||transferIds.has(t.id)||t.fromEntityId===t.toEntityId
     ||!entities.has(t.fromEntityId)||!entities.has(t.toEntityId))throw new RangeError("bad transfer");
   transferIds.add(t.id);
   const lines=linesByTransfer.get(t.id)??[];
   if(lines.length!==2)throw new RangeError("transfer must have exactly two matching cash ledger lines");
   const debit=lines.find(x=>x.entityId===t.fromEntityId);
   const credit=lines.find(x=>x.entityId===t.toEntityId);
   if(!debit||!credit||debit.month!==t.month||credit.month!==t.month
     ||debit.category!==t.category||credit.category!==t.category
     ||!close(debit.amount,-t.amount)||!close(credit.amount,t.amount))
       throw new RangeError("transfer ledger proof mismatch");
   proof.push({id:t.id,month:t.month,category:t.category,
     debitLineId:debit.id,creditLineId:credit.id,netGroupCash:debit.amount+credit.amount,
     status:"verified"});
 }
 for(const ref of linesByTransfer.keys())if(!transferIds.has(ref))throw new RangeError("orphan internal transfer line");
 return {proof,internalNetCash:proof.reduce((a,b)=>a+b.netGroupCash,0),status:"verified"};
}
/** Never remove external rent or VAT; tax implications of both legal entities remain separate. */
export function reconcileVATCash({
 grossReceipts,grossPayments,outputVAT,inputVAT,settlementPayment=0,settlementRefund=0,
 actualCashNet,creditsAllowed,expectedNetVATPayment,expectedNetVATRefund
}){
 for(const [key,value] of Object.entries({grossReceipts,grossPayments,outputVAT,inputVAT,settlementPayment,settlementRefund,actualCashNet,creditsAllowed,expectedNetVATPayment,expectedNetVATRefund}))
    finite(value,key);
 if([grossReceipts,grossPayments,outputVAT,inputVAT,settlementPayment,settlementRefund,creditsAllowed,expectedNetVATPayment,expectedNetVATRefund].some(x=>x<0))
   throw new RangeError("VAT bridge inputs must be nonnegative");
 if(creditsAllowed>inputVAT+1e-6)throw new RangeError("credit exceeds input VAT");
 if(!close(expectedNetVATPayment-expectedNetVATRefund,outputVAT-creditsAllowed))
   throw new RangeError("VAT assessment reconciliation failed");
 const calculated=grossReceipts-grossPayments-settlementPayment+settlementRefund;
 if(!close(calculated,actualCashNet))throw new RangeError("VAT cash payment counted twice or omitted");
 return {grossReceipts,grossPayments,settlementPayment,settlementRefund,
  netCash:calculated,vatAssessment:expectedNetVATPayment-expectedNetVATRefund,status:"verified"};
}
