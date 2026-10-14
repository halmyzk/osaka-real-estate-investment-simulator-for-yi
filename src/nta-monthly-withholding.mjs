/**
 * Gate B: narrowly verified NTA monthly withholding lookup.
 * Source: NTA official 2026 monthly table p.1-2 and 2027 p.1-2.
 * 2026 https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/all.pdf
 * 2027 https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/data/01-07.pdf
 *
 * Only the copied table rows below are supported. Every bracket is
 * [inclusive lower, exclusive upper); the 2026/2027 tables differ.
 * This is NOT a complete payroll engine. Daily, bonuses, otsu/hei, >7
 * dependents, and all unlisted salary bands return incomplete.
 */
const sources=Object.freeze({
  2026:"https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/all.pdf",
  2027:"https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/data/01-07.pdf"
});
const fixture=(from,to,ko,page)=>({from,to,ko,page});
const zero=Object.freeze([0,0,0,0,0,0,0,0]);
const only0=x=>[x,0,0,0,0,0,0,0];
const rows={
  2026:[
    fixture(0,105000,zero,1),
    fixture(105000,107000,only0(170),1),
    fixture(107000,109000,only0(280),1),
    fixture(109000,111000,only0(380),1),
    fixture(111000,113000,only0(480),1),
    fixture(113000,115000,only0(580),1),
    fixture(115000,117000,only0(680),1),
    fixture(117000,119000,only0(790),1),
    fixture(119000,121000,only0(890),1),
    fixture(121000,123000,only0(990),1),
    fixture(123000,125000,only0(1090),1),
    fixture(137000,139000,[1810,190,0,0,0,0,0,0],1),
    fixture(299000,302000,[7930,6320,4700,3080,1470,0,0,0],2)
  ],
  2027:[
    fixture(0,111000,zero,1),
    fixture(111000,113000,only0(140),1),
    fixture(113000,115000,only0(250),1),
    fixture(115000,117000,only0(350),1),
    fixture(117000,119000,only0(450),1),
    fixture(119000,121000,only0(550),1),
    fixture(121000,123000,only0(650),1),
    fixture(123000,125000,only0(760),1),
    fixture(125000,127000,only0(860),1),
    fixture(127000,129000,only0(960),1),
    fixture(129000,131000,only0(1060),1),
    fixture(143000,145000,[1780,160,0,0,0,0,0,0],1),
    fixture(299000,302000,[7760,6150,4530,2910,1300,0,0,0],2)
  ]
};
/**
 * NTA monthly table: taxableMonthlyBase is gross taxable monetary salary
 * (including taxable in-kind benefits) LESS social insurance, in integer yen.
 * Dependents are the number for the table, NOT simply the number of children.
 */
export function lookupNtaMonthlyWithholding({taxYear,taxableMonthlyBase,tableColumn,dependentCount,payPeriod}){
  if(!Number.isInteger(taxYear)||taxYear<1900||
    !Number.isSafeInteger(taxableMonthlyBase)||taxableMonthlyBase<0 ||
    !Number.isInteger(dependentCount)||dependentCount<0)
    throw new RangeError("Valid year, integer taxable yen base and table dependent count required");
  if(!["ko","otsu","hei"].includes(tableColumn)||!["monthly","daily","bonus"].includes(payPeriod))
    throw new RangeError("Explicit tax table and pay period required");
  const yearRows=rows[taxYear];
  if(!yearRows||tableColumn!=="ko"||payPeriod!=="monthly"||dependentCount>7)
    return {status:"incomplete",taxYear,taxableMonthlyBase,tableColumn,dependentCount,
      reason:"Year/table/period/dependent count not covered by verified NTA lookup"};
  const matching=yearRows.filter(row=>taxableMonthlyBase>=row.from&&taxableMonthlyBase<row.to);
  if(matching.length!==1)
    return {status:"incomplete",taxYear,taxableMonthlyBase,tableColumn,dependentCount,
      reason:"This salary band is outside independently transcribed official rows"};
  const line=matching[0];
  return {status:"officialRowVerified",taxYear,taxableMonthlyBase,tableColumn,dependentCount,
    payPeriod,withholdingAmount:line.ko[dependentCount],
    amountLowerInclusive:line.from,amountUpperExclusive:line.to,
    sourceUrl:sources[taxYear],sourcePage:line.page,
    version:"NTA-MONTHLY-"+taxYear+"-VERIFIED-SUBSET",
    note:"Official selected row transcribed and regression tested; NOT entire yearly tax table or a filing calculation"};
}
export const officialNtaTableSources=Object.freeze({...sources});
