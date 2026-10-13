export function auditOperatingVAT({operating, rows}) {
  if (operating?.status !== "computed" || !Array.isArray(rows)) throw new TypeError("Inputs required");
  const expected = {
    lodgingRevenue: operating.lodging.revenue,
    rentalRevenue: operating.rental.revenue,
    lodgingOperating: operating.expenses.lodgingOperating,
    rentalOperating: operating.expenses.rentalOperating,
    propertyOperating: operating.expenses.propertyOperating,
    masterRent: operating.expenses.masterRent,
    maintenanceCapEx: operating.expenses.maintenanceCapEx
  };
  const observed = Object.fromEntries(Object.keys(expected).map(k => [k, 0]));
  const ids = new Set();
  let grossReceipts = 0, grossPayments = 0;
  for (const r of rows) {
    if (!r.id || ids.has(r.id)) throw new RangeError("Duplicate invoice");
    ids.add(r.id);
    if (!Object.hasOwn(expected, r.category)) throw new RangeError("Unknown category");
    for (const k of ["net", "vat", "gross"]) {
      if (typeof r[k] !== "number" || !Number.isFinite(r[k]) || r[k] < 0) throw new RangeError("Invalid amount");
    }
    if (Math.abs(r.gross - r.net - r.vat) > .01) throw new RangeError("VAT gross mismatch");
    if (!["taxable", "exempt", "outOfScope"].includes(r.vatClass)) throw new RangeError("VAT class missing");
    if (r.vatClass !== "taxable" && r.vat !== 0) throw new RangeError("VAT on non-taxable line");
    const sale = r.category.endsWith("Revenue");
    if (r.kind !== (sale ? "sale" : r.category === "maintenanceCapEx" ? "capital" : "expense")) throw new RangeError("Cash category mismatch");
    observed[r.category] += r.net;
    if (sale) grossReceipts += r.gross; else grossPayments += r.gross;
  }
  const differences = Object.keys(expected).map(k => ({category:k, difference: observed[k] - expected[k]}));
  if (differences.some(x => Math.abs(x.difference) > .01)) throw new RangeError("Net P/L differs from VAT detail");
  return {status:"verified", differences, grossReceipts, grossPayments,
    netBeforeWorkingCapitalAndVATSettlement:grossReceipts-grossPayments,
    sourceIsolationRequired:true};
}
export function auditTaxCompleteness({entities, years, checks}) {
  if (!Array.isArray(entities) || !Array.isArray(years) || !Array.isArray(checks)) throw new TypeError("Arrays required");
  const required = ["income", "assets", "vat", "cashSchedule"];
  const results = [];
  for (const entityId of entities) for (const year of years) {
    const missing = [], estimated = [];
    for (const area of required) {
      const matches = checks.filter(x => x.entityId === entityId && x.year === year && x.area === area);
      if (matches.length !== 1 || !["computed","estimated"].includes(matches[0].status)) missing.push(area);
      else if (matches[0].status === "estimated") estimated.push(area);
    }
    results.push({entityId, year, status: missing.length ? "incomplete" : estimated.length ? "estimated" : "computed",missing,estimated});
  }
  return {results,status:results.some(x=>x.status==="incomplete")?"incomplete":results.some(x=>x.status==="estimated")?"estimated":"computed"};
}
