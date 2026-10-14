/**
 * v1.1 saved-model calculation adapter (restricted pre-tax vertical slice).
 *
 * Consumes actual Gate D schema fields, resolves scenario overrides, converts
 * percent -> decimal, enforces actual calendar month, closes financing/deposits,
 * and feeds Gate A operating -> cash-ledger -> portfolio NPV/IRR.
 *
 * Unsupported tax and advanced transactions deliberately make post-tax
 * metrics INCOMPLETE, never zero. No localStorage or v1 mutation.
 */
import {inspectScenarioOverrides,resolveV11Field,requireResolvedNumber,numericPercent} from "./v11-field-resolver.mjs";
import {calculateOperatingMonth,validateAnnualLodgingAllocation} from "./operations.mjs";
import {investingEvents,ledgerFromLoan,compilePretaxLedger} from "./finance.mjs";
import {evaluatePortfolio} from "./portfolio.mjs";
import {compileV11IncomeTaxSidecar} from "./v11-income-tax-sidecar.mjs";
import {buildV11TaxSourceCrosswalk} from "./v11-tax-source-crosswalk.mjs";
import {deriveV11OrdinaryTax} from "./v11-derived-ordinary-tax.mjs";
const money=(n,k)=>{if(typeof n!=="number"||!Number.isFinite(n)||n<0)throw new RangeError(k+" must be nonnegative finite number");return n};
const id=(s,k)=>{if(typeof s!=="string"||!s)throw new TypeError(k+" required");return s};
const ISO=(s,k)=>{
 id(s,k);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new RangeError(k+" must be YYYY-MM-DD");
 const d=new Date(s+"T00:00:00Z");
 if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==s)throw new RangeError(k+" is invalid date");
 return s;
};
const monthOf=s=>s.slice(0,7);
const daysOf=s=>new Date(Date.UTC(Number(s.slice(0,4)),Number(s.slice(5,7)),0)).getUTCDate();
const monthEnd=s=>s+"-"+String(daysOf(s)).padStart(2,"0");
const index=s=>Number(s.slice(0,4))*12+Number(s.slice(5,7))-1;
const monthFrom=i=>Math.floor(i/12)+"-"+String(i%12+1).padStart(2,"0");
const months=(start,end)=>{if(index(end)-index(start)<0||index(end)-index(start)>600)
 throw new RangeError("evaluation horizon invalid or too long");
 return Array.from({length:index(end)-index(start)+1},(_,i)=>monthFrom(index(start)+i));};
const pctToRatio=(result,path,missing)=>{
 const r=numericPercent(result);
 if(r.status!=="available"){missing.push({fieldId:path,reason:"Required percent missing"});return null;}
 return r.value;
};
const number=(result,path,missing)=>{
 const r=requireResolvedNumber(result,{min:0});
 if(r.status!=="available"){missing.push({fieldId:path,reason:"Required numeric value missing"});return null;}
 return r.value;
};
/** Gate C stored fields are optional; using absent optional zero is disclosed. */
const optional=(result,path,defaults,{positive=false}={})=>{
 if(result.status==="incomplete"){
  if(result.origin!=="missing")throw new RangeError(path+" explicitly marked unavailable; cannot assume zero");
  defaults.add(path);
  return 0;
 }
 const v=requireResolvedNumber(result,{min:0});
 if(v.status!=="available")throw new RangeError(path+" invalid");
 if(positive&&v.value<=0)throw new RangeError(path+" must be positive");
 return v.value;
};
const empty=()=>({lodgingOperating:0,rentalOperating:0,propertyOperating:0,masterRent:0});
const matchesMonth=(s,year,month)=>s.year===year&&s.month===month;
const allowedAssetCategory=new Set(["furniture","appliance","buildingEquipment","leaseholdImprovement","other"]);
const incomeField=new Set(["H01","H02","H04","H05","H06","H07","H08","H09","H10","H11","H12","R01","R02","R05","R08","A01","A02","A05","A06","A07","A08","K01"]);
function explicitUnsupportedFields(unit,lookup){
 const excluded=["A04","A09","A10","K06","R06","R07","R10","R11","S03","S04","S08","F02","F03","F05","F06"];
 for(const fieldId of excluded){
  const r=lookup(fieldId,null);
  if(r.status==="available"&&typeof r.value==="number"&&r.value!==0)
   throw new RangeError(fieldId+" requires an advanced transaction/tax adapter; cannot ignore a nonzero value");
 }
 // F01 may be a UI financing summary, but cannot contradict the loan ledger.
 const financeFlag=lookup("F01",null);
 if(financeFlag.status==="available"&&typeof financeFlag.value==="boolean"){
   if(financeFlag.value!==((unit.loans??[]).some(x=>x.principal>0)))
     throw new RangeError("F01 loan-enabled flag differs from unit loan contracts");
 }
}
function resolveUnit(document,scenarioContext,unit,portfolio,assumptions){
 const missing=[],defaults=new Set(),trace=[];
 const get=(fieldId,record=null)=>{
  const result=resolveV11Field({document,scenarioContext,fieldId,unitId:unit.id,
   year:record?.year??null,month:record?.month??null});
  if(result.status==="available")trace.push({fieldId,month:record?record.year+"-"+String(record.month).padStart(2,"0"):null,
   sourceType:result.sourceType,origin:result.origin});
  return result;
 };
 const getOptional=(fieldId,record)=>optional(get(fieldId,record),fieldId,defaults);
 const getRequired=(fieldId,record)=>number(get(fieldId,record),fieldId,missing);
 const getPercent=(fieldId,record)=>pctToRatio(get(fieldId,record),fieldId,missing);
 const start=ISO(unit.startDate,"startDate");
 const open=ISO(unit.operationStartDate,"operationStartDate");
 const exit=ISO(unit.exit?.exitDate,"exitDate");
 if(!/\-01$/.test(start)||!/\-01$/.test(open)||exit!==monthEnd(monthOf(exit)))
    throw new RangeError("partial acquisition/opening/exit months not supported by this adapter");
 if(start<portfolio.baseDate||open<start||exit<open||index(monthOf(exit))>=index(monthOf(portfolio.baseDate))+portfolio.holdingYears*12)
    throw new RangeError("start/open/exit outside valuation horizon");
 if(unit.ownerEntityId!==null && unit.ownerEntityId!==undefined &&
  unit.ownerEntityId!==unit.operatorEntityId)
    throw new RangeError("split owner/operator tax and inter-entity rent not integrated");
 if(unit.tenantEntityId!==null&&unit.tenantEntityId!==undefined&&
    unit.tenantEntityId!==unit.operatorEntityId)
    throw new RangeError("split tenant/operator cash not integrated");
 const home=unit.tenure==="own"?unit.ownerEntityId??unit.operatorEntityId:unit.operatorEntityId;
 if(home!==unit.operatorEntityId)throw new RangeError("cash owner/operator mismatch");
 const entity=document.entities.find(x=>x.id===unit.operatorEntityId);
 if(!entity)throw new RangeError("unknown unit legal entity");
 if(!["own","lease"].includes(unit.tenure)||!["M1","M2","M3","M4"].includes(unit.modelId))
    throw new RangeError("unknown unit model or tenure");
 explicitUnsupportedFields(unit,get);
 const purchase=unit.tenure==="own"?getRequired("A01"):0;
 const masterRent=unit.tenure==="lease"?getRequired("A06"):0;
 if(unit.tenure==="own" && getOptional("A06")!==0)throw new RangeError("owned unit has master rent");
 if(unit.tenure==="lease" && getOptional("A01")!==0)throw new RangeError("leased unit has property purchase price");
 const closing=getOptional("A02");
 const deposit=getOptional("A07");
 const leaseFee=getOptional("A08");
 const holding=getOptional("A05");
 const nominalCapital=get("K01");
 const calcCapital=nominalCapital.status==="available"?number(nominalCapital,"K01",missing):null;
 const activeMonths=months(monthOf(open),monthOf(exit));
 const expectedActive=new Set(activeMonths);
 const suppliedCalendar=unit.calendar??[];
 if(!Array.isArray(suppliedCalendar))throw new TypeError("calendar array required");
 // Gate C §15.4: M4 rents all otherwise available days by default. Only
 // a user-provided M4 month overrides this calendar convention.
 const allCalendar=[...suppliedCalendar];
 if(unit.modelId==="M4"){
  const suppliedKeys=new Set(allCalendar.map(r=>r.year+"-"+String(r.month).padStart(2,"0")));
  for(const mo of activeMonths){
    if(!suppliedKeys.has(mo))allCalendar.push({
      year:Number(mo.slice(0,4)),month:Number(mo.slice(5,7)),
      lodgingDays:0,rentalDays:daysOf(mo),selfUseDays:0,changeoverDays:0,idleDays:0
    });
  }
 }
 const byMonth=new Map();
 for(const row of allCalendar){
  if(!Number.isInteger(row.year)||!Number.isInteger(row.month)||row.month<1||row.month>12)
    throw new RangeError("invalid calendar date");
  const mo=row.year+"-"+String(row.month).padStart(2,"0");
  if(byMonth.has(mo))throw new RangeError("duplicate month in unit calendar");
  if(!expectedActive.has(mo))throw new RangeError("calendar outside operating period");
  byMonth.set(mo,row);
 }
 for(const mo of activeMonths)if(!byMonth.has(mo))
  missing.push({fieldId:"H03/R03/S01",month:mo,reason:"Full monthly use allocation required"});
 validateAnnualLodgingAllocation(unit.modelId,allCalendar.map(x=>({year:x.year,lodgingDays:x.lodgingDays})));
 for(const row of allCalendar){
  if(row.lodgingDays+row.rentalDays+row.selfUseDays+row.changeoverDays+row.idleDays!==
   daysOf(row.year+"-"+String(row.month).padStart(2,"0")))throw new RangeError("calendar allocation not equal real month days");
 }
 const expenses=unit.expenses??[];
 if(!Array.isArray(expenses))throw new TypeError("expenses required");
 const expenseBuckets=new Map();
 const expenseIds=new Set();
 for(const e of expenses){
  if(expenseIds.has(e.id))throw new RangeError("duplicate expense ID");
  expenseIds.add(e.id);
  if(e.entityId!==unit.operatorEntityId)throw new RangeError("other-entity expense must be separately allocated");
  if(!["lodgingOperating","rentalOperating","propertyOperating","headRent"].includes(e.category))
    throw new RangeError("unsupported explicit expense category "+e.category);
  ISO(e.periodStart,"expense periodStart");ISO(e.periodEnd,"expense periodEnd");
  if(e.periodStart!==monthOf(e.periodStart)+"-01"||
   e.periodEnd!==monthEnd(monthOf(e.periodStart))||
   e.cashDate===undefined||e.cashDate===null||
   monthOf(ISO(e.cashDate,"expense cashDate"))!==monthOf(e.periodStart))
    throw new RangeError("multi-month/accrual-cash expense timing requires advanced adapter");
  const k=monthOf(e.periodStart);
  if(k<monthOf(start)||k>monthOf(exit))throw new RangeError("expense outside unit holding period");
  if(e.businessUseRatio!==undefined && e.businessUseRatio!==100)
    throw new RangeError("partial business expense allocation requires tax allocation adapter");
  if(e.taxTreatment==="capital")throw new RangeError("capital expense must be an asset, not operating cost");
  const amount=money(e.amount,"expense amount");
  const dest=expenseBuckets.get(k)??empty();
  dest[e.category==="headRent"?"masterRent":e.category]+=amount;
  expenseBuckets.set(k,dest);
 }
 const operating=[];
 for(const mo of months(monthOf(start),monthOf(exit))){
  const record=byMonth.get(mo)??null;
  const fullDays=daysOf(mo);
  const isOpen=index(mo)>=index(monthOf(open));
  const allocation=record??{year:Number(mo.slice(0,4)),month:Number(mo.slice(5,7)),
    lodgingDays:0,rentalDays:0,selfUseDays:0,changeoverDays:0,idleDays:fullDays};
  const costs={...empty(),...expenseBuckets.get(mo)};
  costs.propertyOperating+=holding;
  if(unit.tenure==="lease"){
    if(costs.masterRent!==0&&masterRent!==0)
      throw new RangeError("master rent included twice: A06 plus headRent expense");
    costs.masterRent+=masterRent;
  }
  const monthSinceStart=index(mo)-index(monthOf(open));
  const elapsedYears=Math.floor(monthSinceStart/12);
  const pg=number(get("P05"),"P05",missing),pc=number(get("P06"),"P06",missing);
  const revenueGrowth=pg===null?null:Math.pow(1+pg/100,elapsedYears);
  const operatingCostGrowth=pc===null?null:Math.pow(1+pc/100,elapsedYears);
  if(operatingCostGrowth!==null){
    // Contract head rent and explicitly dated actual expense lines are never
    // escalated here; nominal field-derived recurring costs alone are.
    costs.propertyOperating+=holding*(operatingCostGrowth-1);
  }
  const lodgingDays=allocation.lodgingDays;
  const rentalDays=allocation.rentalDays;
  let lodging=null,rental=null;
  if(lodgingDays>0){
    const adr=getRequired("H01",allocation);
    const occ=getPercent("H02",allocation);
    let unavailable=allocation.lodgingUnavailableWithinAllocationDays??null;
    const h04=get("H04",allocation);
    if(h04.status==="available"){
      const v=number(h04,"H04",missing);
      if(unavailable!==null && unavailable!==v)throw new RangeError("H04 conflicts with unavailable lodging days");
      unavailable=v;
    }else if(h04.origin!=="missing"){
      missing.push({fieldId:"H04",month:mo,reason:"Unavailable days unknown"});
    }
    unavailable??=0;
    const adrFactor=get("H05",allocation);
    const occFactor=get("H06",allocation);
    const af=number(adrFactor,"H05",missing),of=number(occFactor,"H06",missing);
    const ramp=get("P07"); const rampRatio=pctToRatio(ramp,"P07",missing);
    const ratio=occ!==null&&of!==null&&rampRatio!==null?
      occ*of*(monthSinceStart<12?rampRatio:1):null;
    if(ratio!==null&&ratio>1)throw new RangeError("effective lodging occupancy exceeds 100%");
    const ancillary=getOptional("H11",allocation);
    lodging={unavailableDays:unavailable,occupancy:ratio??0,
      adr:adr===null||af===null||revenueGrowth===null?0:adr*af*revenueGrowth,
      ancillaryRevenue:ancillary};
    const rooms=lodgingDays-unavailable;
    const expectedSold=ratio===null?0:rooms*ratio;
    const h08=getOptional("H08",allocation);
    const h09=getOptional("H09",allocation);
    const h07=get("H07",allocation);
    const avgStay=h07.status==="available"?number(h07,"H07",missing):null;
    if(h09!==0&&(avgStay===null||avgStay<=0))
      missing.push({fieldId:"H07",month:mo,reason:"Positive cleaning unit cost requires average stay"});
    costs.lodgingOperating+= (adr===null||af===null||revenueGrowth===null?0:expectedSold*adr*af*revenueGrowth)*h08/100+
      (h09===0||!avgStay||operatingCostGrowth===null?0:expectedSold/avgStay*h09*operatingCostGrowth)+
      (getOptional("H10",allocation)+getOptional("H12",allocation))*(operatingCostGrowth??0);
  }
  if(rentalDays>0){
    const mr=getRequired("R01",allocation),occ=getPercent("R02",allocation);
    rental={mode:"forecast",monthlyRent:mr===null||revenueGrowth===null?0:mr*revenueGrowth,
      occupancy:occ??0,otherRevenue:0};
    costs.rentalOperating+=(getOptional("R05",allocation)+getOptional("R08",allocation))*(operatingCostGrowth??0);
  }
  if(!isOpen && record)throw new RangeError("operating allocation before operationStartDate");
  const result=calculateOperatingMonth({
   modelId:unit.modelId,tenure:unit.tenure,calendarDays:fullDays,
   lodgingDays,rentalDays,selfUseDays:allocation.selfUseDays,
   changeoverDays:allocation.changeoverDays,idleDays:allocation.idleDays,
   lodging,rental,costs,maintenanceCapEx:0,deltaOperatingNWC:0
  });
  operating.push({unitId:unit.id,month:mo,result});
 }
 const investing=[];
 const monthStart=monthOf(start),exitMonth=monthOf(exit);
 if(unit.tenure==="own"){
  if(deposit!==0||leaseFee!==0||money(unit.exit.expectedDepositRefund,"expectedDepositRefund")!==0)
    throw new RangeError("owned property cannot have leased refundable deposit or lease setup fee");
  if(purchase!==null)investing.push(...investingEvents({acquisitions:[
   {id:unit.id+"-purchase",month:monthStart,price:purchase,closingCosts:closing}]}));
  if(unit.exit.method!=="priceGrowth")
    throw new RangeError("sale cap reference and special exit modes not supported");
  if(unit.exit.applyResidentialRelief)throw new RangeError("sale tax relief requires reviewed Gate B");
  const portfolioGrowth=get("P09");
  const growth=unit.exit.priceGrowthRate??number(portfolioGrowth,"P09",missing);
  if(typeof growth!=="number"||!Number.isFinite(growth)||growth<=-100)
    throw new RangeError("exit price growth rate must be percentage > -100");
  const yrs=(index(exitMonth)-index(monthStart)+1)/12;
  if(purchase!==null)investing.push(...investingEvents({disposals:[
   {id:unit.id+"-sale",month:exitMonth,
    proceeds:purchase*Math.pow(1+growth/100,yrs),
    sellingCosts:money(unit.exit.sellingCosts,"sellingCosts"),
    exitObligations:money(unit.exit.exitObligations,"exitObligations") }]}));
 }else{
  if(unit.exit.method!=="leaseSettlement")throw new RangeError("lease cannot sell underlying real estate");
  if(money(unit.exit.sellingCosts,"sellingCosts")!==0)throw new RangeError("lease selling costs require documented lease closeout category");
  if(closing>0)throw new RangeError("lease closing costs require dedicated categorization");
  if(deposit>0)investing.push(...investingEvents({refundableDeposits:[
    {id:unit.id+"-deposit-paid",month:monthStart,action:"paid",amount:deposit}]}));
  if(leaseFee>0)investing.push(...investingEvents({capitalSpending:[
    {id:unit.id+"-lease-fee",month:monthStart,purpose:"initial",amount:leaseFee}]}));
  const refund=money(unit.exit.expectedDepositRefund,"expectedDepositRefund");
  if(refund>deposit)throw new RangeError("refunded deposit above deposit originally paid");
  if(refund>0)investing.push(...investingEvents({refundableDeposits:[
    {id:unit.id+"-deposit-returned",month:exitMonth,action:"refunded",amount:refund}]}));
  const obligation=money(unit.exit.exitObligations,"exitObligations");
  if(obligation>0)investing.push(...investingEvents({disposals:[
    {id:unit.id+"-lease-end",month:exitMonth,proceeds:0,sellingCosts:0,exitObligations:obligation}]}));
 }
 if(!Array.isArray(unit.assets)||!Array.isArray(unit.loans))
    throw new TypeError("assets and loans required");
 if(unit.assets.length){
  // The land/building purchase is ALREADY booked by A01. An asset register
  // supplies tax-basis classification only, never a second initial CapEx.
  const realEstate=unit.assets.filter(a=>a.category==="land"||a.category==="building");
  const otherAssets=unit.assets.filter(a=>a.category!=="land"&&a.category!=="building");
  if(realEstate.length){
    if(unit.tenure!=="own"||realEstate.length!==2||
      new Set(realEstate.map(a=>a.category)).size!==2)
      throw new RangeError("Real-estate property tax register requires one land and one building for an owned unit");
    const basis=realEstate.reduce((t,a)=>t+money(a.grossCost,"grossCost"),0);
    if(purchase===null||Math.abs(basis-purchase)>1e-6)
      throw new RangeError("Land plus building gross costs must reconcile exactly to A01 purchase");
  }
  const total=otherAssets.reduce((t,a)=>t+money(a.grossCost,"grossCost"),0);
  if(calcCapital!==null&&Math.abs(total-calcCapital)>1e-6)
    throw new RangeError("K01 must reconcile to detailed non-property capital assets");
  const ids=new Set();
  for(const a of unit.assets){
   if(ids.has(a.id))throw new RangeError("duplicate asset ID");
   ids.add(a.id);
   if(a.ownerEntityId!==unit.operatorEntityId)
     throw new RangeError("asset owner must match tax/cash entity");
   const date=ISO(a.invoiceDate,"asset invoice date");
   if(date<start||date>exit)throw new RangeError("asset invoice outside holding");
   if(a.category==="land"||a.category==="building"){
     if(date!==start)throw new RangeError("Real-estate tax register invoice must align with A01 acquisition");
     if(a.disposalDate!==undefined&&a.disposalDate!==null&&a.disposalDate!==exit)
       throw new RangeError("Real-estate asset disposal date must match exit sale");
     // No second investment cash; the property was acquired in A01.
     continue;
   }
   if(!allowedAssetCategory.has(a.category))
     throw new RangeError("Asset category unsupported by preview");
   investing.push(...investingEvents({capitalSpending:[
    {id:unit.id+"-"+a.id,month:monthOf(date),purpose:"initial",amount:a.grossCost}]}));
  }
 }else if(calcCapital!==null&&calcCapital>0){
  missing.push({fieldId:"K02",reason:"K01 amount lacks asset-level classification; cannot book unsupported investment"});
 }
 const financing=[],loanIds=new Set();
 for(const loan of unit.loans){
  if(loanIds.has(loan.id))throw new RangeError("duplicate loan ID");
  loanIds.add(loan.id);
  if(loan.borrowerEntityId!==unit.operatorEntityId)
    throw new RangeError("cross-entity borrowing not supported");
  ISO(loan.drawDate,"loan draw date");
  if(loan.drawDate<start||loan.drawDate>exit)throw new RangeError("loan outside holding");
  if(loan.repaymentMethod==="custom"||loan.prepayments?.length)
    throw new RangeError("custom loan/prepayment requires dedicated finance mapping");
  const loanResult=ledgerFromLoan({
   loanId:unit.id+"-"+loan.id,drawMonth:monthOf(loan.drawDate),
   principal:loan.principal,annualInterestRate:loan.annualInterestRate/100,
   termMonths:loan.termMonths,repaymentMethod:loan.repaymentMethod,
   originationFee:loan.fees??0
  },exitMonth);
  financing.push(...loanResult.events);
 }
 if(missing.length)return {unitId:unit.id,entityId:unit.operatorEntityId,status:"incomplete",
   missing,optionalZeroDefaults:[...defaults],operating:[],investing:[],financing:[],trace};
 return {unitId:unit.id,entityId:unit.operatorEntityId,status:"computed",
   missing,optionalZeroDefaults:[...defaults],operating,investing,financing,trace};
}
export function previewV11Scenario(document,{scenarioId,incomeTaxSidecar=null,derivedTaxPlan=null}={}){
 if(incomeTaxSidecar!==null&&derivedTaxPlan!==null)
   throw new RangeError("Use either external tax sidecar or derived ordinary-tax plan, not both");
 if(document?.schemaVersion!=="1.1.0"||!Array.isArray(document.entities)||
 !Array.isArray(document.units)||!document.units.length)
  throw new TypeError("Complete v1.1 portfolio/entities/units document required");
 const p=document.portfolio;
 if(!p||p.currency!=="JPY")throw new RangeError("portfolio in JPY required");
 ISO(p.baseDate,"portfolio base date");
 if(!/\-01-01$/.test(p.baseDate))
  return {status:"incomplete",missing:[{fieldId:"P02",reason:"Prototype supports January 1 valuation dates only"}],
    preTax:null,afterTax:null,units:[]};
 if(!Number.isInteger(p.holdingYears)||p.holdingYears<1)throw new RangeError("invalid holdingYears");
 const entityIds=new Set(),unitIds=new Set();
 for(const e of document.entities){
  id(e.id,"entity.id");if(entityIds.has(e.id))throw new RangeError("duplicate entity");entityIds.add(e.id);
 }
 for(const u of document.units){
  id(u.id,"unit.id");if(unitIds.has(u.id))throw new RangeError("duplicate unit");unitIds.add(u.id);
 }
 const scenario=inspectScenarioOverrides({document,scenarioId:scenarioId??document.scenarios.find(x=>x.role==="base")?.id});
 const previewSupportedOverrides=new Set([
   "P04","P05","P06","P07","P09",
   "H01","H02","H04","H05","H06","H07","H08","H09","H10","H11","H12",
   "R01","R02","R05","R08",
   "A01","A02","A05","A06","A07","A08","K01"
 ]);
 const selectedScenario=document.scenarios.find(x=>x.id===scenario.scenarioId);
 for(const over of selectedScenario.overrides){
   if(!previewSupportedOverrides.has(over.fieldId))
     throw new RangeError("scenario override "+over.fieldId+" not yet supported by preview; cannot silently omit its effect");
 }
 const resolvedDiscount=resolveV11Field({document,scenarioContext:scenario,fieldId:"P04"});
 let rate=null;
 if(resolvedDiscount.status==="available"){
  const v=requireResolvedNumber(resolvedDiscount,{min:0,max:100});
  if(v.status==="available")rate=v.value/100;
 }
 const unitResults=document.units.map(unit=>resolveUnit(document,scenario,unit,p,[]));
 const missing=unitResults.flatMap(x=>x.missing.map(m=>({...m,unitId:x.unitId})));
 if(missing.length){
  return {status:"incomplete",scenarioId:scenario.scenarioId,
   missing,units:unitResults,preTax:null,afterTax:null,
   reason:"All required fields and every active calendar month must be completed before evaluating investment KPIs"};
 }
 const taxSourceCrosswalk=buildV11TaxSourceCrosswalk({document,unitResults});
 const byEntity=new Map([...entityIds].map(x=>[x,{operatingMonths:[],investing:[],financing:[]}]));
 for(const u of unitResults){
  const bucket=byEntity.get(u.entityId);
  if(!bucket)throw new RangeError("orphan unit entity");
  bucket.operatingMonths.push(...u.operating);bucket.investing.push(...u.investing);
  bucket.financing.push(...u.financing);
 }
 const t0=[],ledgers=[];
 const baseMonth=monthOf(p.baseDate);
 for(const [entityId,bucket] of byEntity){
  // CF0 is initial equity funding, not every event in the initial month.
  // Disposal receipts and exit debt payoff in that same calendar month belong
  // to year-1 CF, otherwise the return can be materially misrepresented.
  const initInvest=new Set(["acquisitionPrice","closingCosts","initialCapEx"]);
  const initFinance=new Set(["loanDrawdown","financingFee"]);
  const isInitial=x=>x.month===baseMonth&&
    (x.kind==="investing"?initInvest.has(x.category)||
      (x.category==="refundableDeposit"&&x.amount<0):initFinance.has(x.category));
  const initial=[...bucket.investing,...bucket.financing].filter(isInitial);
  if(initial.length)t0.push({entityId,amount:initial.reduce((a,x)=>a+x.amount,0)});
  ledgers.push({entityId,ledger:compilePretaxLedger({
    operatingMonths:bucket.operatingMonths,
    investing:bucket.investing.filter(x=>!isInitial(x)),
    financing:bucket.financing.filter(x=>!isInitial(x))
   })});
 }
 const year=Number(p.baseDate.slice(0,4));
 const report=evaluatePortfolio({
  entityLedgers:ledgers,timeZero:t0,baseCalendarYear:year,
  holdingYears:p.holdingYears,discountRate:rate,
  taxCoverage:[...entityIds].map(entityId=>({entityId,status:"incomplete"}))
 });
 // An externally prepared assessment sidecar can connect annual income-tax
 // assessments to actual payment-calendar years; it NEVER certifies VAT or
 // full after-tax investor valuation. Stale sidecars cannot be reused.
 const tax=derivedTaxPlan===null?compileV11IncomeTaxSidecar({
    document,scenarioId:scenario.scenarioId,sidecar:incomeTaxSidecar
 }):deriveV11OrdinaryTax({
    document,scenarioId:scenario.scenarioId,unitResults,taxPlan:derivedTaxPlan
 });
 const incomeTaxEvents=derivedTaxPlan===null?tax.entries:tax.incomeTaxEvents;
 const incomeTaxReport=tax.status==="estimated"?evaluatePortfolio({
    entityLedgers:ledgers,timeZero:t0,baseCalendarYear:year,
    holdingYears:p.holdingYears,discountRate:rate,taxes:incomeTaxEvents,
    taxCoverage:[...entityIds].map(entityId=>({entityId,status:"estimated"}))
 }):null;
 return {status:"estimated-pre-tax",scenarioId:scenario.scenarioId,units:unitResults,
  preTax:report.preTax,afterTax:null,CF0:report.CF0,
  afterIncomeTaxSensitivity:incomeTaxReport?.afterTax??null,
  incomeTaxCashEvents:tax.status==="estimated"?incomeTaxEvents:[],
  incomeTaxCalculationBasis:derivedTaxPlan===null?"externalAssumedAssessments":"derivedFromUnitOperations",
  derivedTaxUnitYearProof:derivedTaxPlan!==null&&tax.status==="estimated"?tax.unitYearProof:[],
  derivedTaxItems:derivedTaxPlan!==null&&tax.status==="estimated"?tax.taxItems:[],
  ownedAssetTaxRegisters:derivedTaxPlan!==null&&tax.status==="estimated"?tax.ownedAssetTaxRegisters??[]:[],
  incomeTaxStatus:tax.status,
  incomeTaxBlocker:tax.status==="incomplete"?tax.reason:null,
  incomeTaxAudit:tax.status==="estimated"?(tax.audit??[]):[],
  incomeTaxWarnings:tax.status==="estimated"?tax.warnings:[],
  taxSourceCrosswalk,
  referenceDiscountRateBasis:rate===null?null:
   "P04 is the user's AFTER-TAX equity required return. Pre-tax NPV at that same rate is only a sensitivity reference, not an accepted after-tax investment valuation.",
  annual:report.annual.map(x=>({
     year:x.year,operating:x.operating,
     investing:x.investing,financing:x.financing,preTaxEquityCF:x.preTaxEquityCF
  })),
  annualIncomeTaxSensitivity:incomeTaxReport?.annual.map(x=>({
     year:x.year,incrementalTaxCashFlow:x.taxCashFlow,
     postIncomeTaxEquityCF:x.afterTaxEquityCF
  }))??null,
  inputWarnings:unitResults.flatMap(x=>x.optionalZeroDefaults.map(fieldId=>({
    unitId:x.unitId,fieldId,reason:"Optional detail absent, interpreted as zero for this restricted forecast"}))),
  taxStatus:"incomplete",
  limitations:[
    "VAT, complete taxable income/depreciation derivation, inter-entity transfers and FULL after-tax NPV/IRR are NOT evaluated",
    "An optional external-tax sidecar OR reviewed ordinary-income auto-calculation plan produces a provisional post-income-tax sensitivity only; it is not full after-tax cash flow",
    "The pre-tax NPV is a reference sensitivity using P04 after-tax equity discount rate, not a tax-adjusted investor NPV",
    "Full-month acquisitions/openings and month-end exit only; no arbitrary-date partial revenue",
    "Initial transaction amounts in base month belong to CF0 and are not duplicated in year 1",
    "Only evidenced operating inputs and supported acquisition/lease/asset/loan/exit flows are shown",
    "First-year lodging occupancy uses default 60% ramp unless P07 is explicitly 100%",
    "P05 annual nominal revenue growth and P06 field recurring expense growth apply after each 12 months; explicit dated expenses and contract master rent are not automatically escalated"
  ]};
}
