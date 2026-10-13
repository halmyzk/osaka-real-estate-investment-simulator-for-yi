import {auditOperatingVAT} from "./acceptance.mjs";
import {compileVATInclusiveCash,attachVATCashToEntityLedgers} from "./vat-cash.mjs";
import {compilePretaxLedger} from "./finance.mjs";

/**
 * Builds VAT-inclusive economic cash exactly once from validated operating
 * detail. Never builds a conventional net P/L cash ledger first.
 * Other investing transactions must not include the same maintenance CapEx.
 * VAT settlements belong here only, not in separate income-tax event streams.
 */
export function buildReconciledEntityCash({
  entityId,unitMonths,investing=[],financing=[],vatSettlements=[],
  vatCoverageStatus
}){
  if(typeof entityId!=="string"||!entityId)throw new TypeError("entityId required");
  if(!Array.isArray(unitMonths)||!unitMonths.length)throw new TypeError("unitMonths required");
  if(!["computed","estimated"].includes(vatCoverageStatus))
    throw new RangeError("VAT eligibility/settlement completeness unresolved");
  const invoiceIds=new Set(),monthUnits=new Set(),converted=[];
  const workingCapital=new Map();
  for(const u of unitMonths){
    if(!u||typeof u.unitId!=="string"||!u.unitId||typeof u.month!=="string")
      throw new TypeError("unit/month required");
    const key=u.unitId+"|"+u.month;
    if(monthUnits.has(key))throw new RangeError("duplicate unit-month");
    monthUnits.add(key);
    if(!Array.isArray(u.invoices))throw new TypeError("invoices array required");
    const audit=auditOperatingVAT({operating:u.result,rows:u.invoices});
    if(audit.status!=="verified")throw new RangeError("unverified accounting bridge");
    for(const invoice of u.invoices){
      if(invoiceIds.has(invoice.id))throw new RangeError("duplicate invoice across units");
      invoiceIds.add(invoice.id);
      converted.push({id:invoice.id,entityId,month:u.month,
        kind:invoice.kind,netAmount:invoice.net,vatAmount:invoice.vat,
        vatClass:invoice.vatClass,cashGrossAmount:invoice.gross});
    }
    const delta=u.result.expenses.deltaOperatingNWC;
    if(typeof delta!=="number"||!Number.isFinite(delta))throw new RangeError("working capital missing");
    workingCapital.set(u.month,(workingCapital.get(u.month)??0)-delta);
  }
  if(investing.some(x=>["maintenanceCapEx","maintenanceCapExGross","consumptionTaxSettlement"].includes(x.category)))
    throw new RangeError("VAT-included maintenance or VAT settlement duplicated in investment events");
  if(financing.some(x=>x.category==="consumptionTaxSettlement"))
    throw new RangeError("VAT settlement cannot enter financial cash");
  const base=compilePretaxLedger({investing,financing});
  const baseRows=new Map(base.series.map(x=>[x.month,{...x}]));
  for(const [month,nwc] of workingCapital){
    const entry=baseRows.get(month)??{month,operating:0,investing:0,financing:0,pretaxEquityCF:0};
    entry.operating+=nwc;entry.pretaxEquityCF+=nwc;
    baseRows.set(month,entry);
  }
  const baseLedgers=[{entityId,ledger:{series:[...baseRows.values()].sort((a,b)=>a.month.localeCompare(b.month))}}];
  const vat=compileVATInclusiveCash({lines:converted,
    taxSettlements:vatSettlements,taxCoverage:[{entityId,status:vatCoverageStatus}]});
  const result=attachVATCashToEntityLedgers({
    baseLedgers,vatBridge:vat,provenance:"netPnlExcludedFromCash"
  });
  const series=result[0].ledger.series;
  for(const month of series){
    if(Math.abs(month.operating+month.investing+month.financing-month.pretaxEquityCF)>1e-6)
      throw new RangeError("cash ledger fails component reconciliation");
  }
  return {entityId,ledger:result[0].ledger,vatStatus:vat.status,
    sourceInvoiceCount:converted.length,sourceUnitMonthCount:unitMonths.length,
    status:"reconciled",notes:"Tax-inclusive cash and VAT settlement recorded once; income tax requires separate incremental events"};
}
