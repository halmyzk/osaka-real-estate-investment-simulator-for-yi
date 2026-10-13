/**
 * Gate B annual ordinary-income tax calculations for two counterfactuals.
 *
 * Explicitly separates:
 *  - accounting categories and noncash depreciation
 *  - category-specific individual loss treatment
 *  - corporate loss vintages and eligible offset limits
 *  - national vs municipal taxes
 *  - assessment (this file) vs payment-date cash (income-tax-bridge.mjs)
 *
 * Forecast/sensitivity calculation ONLY: legal rates, eligibility, credits
 * and residence tax bases must be independently verified. Exit gain taxes,
 * consumption tax, withholding and advance payments require separate models.
 */
import {aggregateTaxableCategories} from "./portfolio.mjs";
import {applyIndividualIncomeCategories,nationalPersonalIncomeTax,corporateNationalTax} from "./tax.mjs";
import {corporateLossCarryforward,configuredCorporateLocalTaxes} from "./tax-detail.mjs";

const number=(v,name,{min=-Infinity,max=Infinity}={})=>{
 if(typeof v!=="number"||!Number.isFinite(v)||v<min||v>max)
   throw new RangeError(name+" must be a finite number in configured range");
 return v;
};
const required=(s,label)=>{
 if(typeof s!=="string"||!s)throw new TypeError(label+" required");
 return s;
};
const actual=(v,label)=>{if(typeof v!=="boolean")throw new TypeError(label+" must be explicit boolean");return v;};
const ref=(s,label)=>{
 if(typeof s!=="string"||!s.startsWith("https://"))throw new TypeError(label+" source URL required");
 return s;
};
const sum=xs=>xs.reduce((a,b)=>a+b,0);
const close=(x,y)=>Math.abs(x-y)<=1e-6;

/** Validate a strictly configured tax-year rule, never an implied current rate. */
function meta(rule,year){
 if(!rule||rule.taxYear!==year)throw new RangeError("matching tax-year rule required");
 required(rule.ruleVersion,"ruleVersion");ref(rule.sourceUrl,"tax rule");
 if(rule.computationMode!=="standard"&&rule.computationMode!=="detailed")
   throw new RangeError("computationMode required");
 if(rule.assumptionOrConfirmed!=="assumption"&&rule.assumptionOrConfirmed!=="confirmed")
   throw new RangeError("assumptionOrConfirmed required");
 // Legal 'confirmed' classification is not established simply by setting a flag.
 if(rule.assumptionOrConfirmed==="confirmed"&&rule.eligibilityEvidenceReviewed!==true)
   throw new RangeError("confirmed eligibility requires reviewed external evidence");
 return {taxYear:year,ruleVersion:rule.ruleVersion,sourceUrl:rule.sourceUrl,
  assumptionOrConfirmed:rule.assumptionOrConfirmed,computationMode:rule.computationMode};
}
function normalizedItems(items,entityId,taxYear){
 if(!Array.isArray(items))throw new TypeError("tax item array required");
 for(const x of items){
  if(!x||x.entityId!==entityId||x.taxYear!==taxYear)
   throw new RangeError("tax items must share entity and assessment year");
 }
 return aggregateTaxableCategories(items);
}
function tag(id,entityId,year,taxKind,amount,rule){
 return {id,entityId,taxYear:year,taxKind,amount:number(amount,taxKind,{min:0}),
  status:"estimated",...meta(rule,year)};
}
const categories=new Set(["business","realEstate","miscellaneous"]);
const allocation=groups=>Object.fromEntries(["business","realEstate","miscellaneous"].map(k=>
 [k,sum(groups.filter(x=>x.category===k).map(x=>x.taxableCategoryProfit))]));
/**
 * taxRule.personal: {taxYear,ruleVersion,sourceUrl,assumptionOrConfirmed,
 * computationMode,residenceRate,baseRounding,realEstateLossOffsetAllowed,
 * businessLossOffsetAllowed,residenceBaseAdjustment}
 * baselineTaxableIncome is pre-project (after other deductions).
 * The optional residenceBaseAdjustment is a taxpayer-specific *assumption*,
 * not an assertion that individual income and municipal tax bases are equal.
 */
export function assessPersonalYear({
 entityId,taxYear,baselineTaxableIncome,projectTaxItems,taxRule
}){
 required(entityId,"entityId");
 if(!Number.isInteger(taxYear)||taxYear<1900)throw new RangeError("tax year");
 const rule=taxRule?.personal;meta(rule,taxYear);
 number(baselineTaxableIncome,"baselineTaxableIncome",{min:0});
 number(rule.residenceRate,"residenceRate",{min:0,max:1});
 number(rule.residenceBaseAdjustment,"residenceBaseAdjustment");
 actual(rule.realEstateLossOffsetAllowed,"realEstateLossOffsetAllowed");
 actual(rule.businessLossOffsetAllowed,"businessLossOffsetAllowed");
 const rows=normalizedItems(projectTaxItems,entityId,taxYear);
 if(rows.some(r=>!categories.has(r.category)))
   throw new RangeError("individual cannot use corporate income category");
 const breakdown=allocation(rows);
 const baseline=nationalPersonalIncomeTax({
  taxYear,taxableIncome:baselineTaxableIncome,baseRounding:rule.baseRounding});
 const adjusted=applyIndividualIncomeCategories({
  baselineOrdinaryTaxableIncome:baselineTaxableIncome,
  projectCategories:Object.entries(breakdown).map(([category,amount])=>({category,amount})),
  eligibleRealEstateLossOffset:rule.realEstateLossOffsetAllowed,
  eligibleBusinessLossOffset:rule.businessLossOffsetAllowed
 });
 const projected=nationalPersonalIncomeTax({
  taxYear,taxableIncome:adjusted.adjustedTaxableIncome,baseRounding:rule.baseRounding});
 const residence=(ordinary)=>Math.max(0,ordinary+rule.residenceBaseAdjustment)*rule.residenceRate;
 const residenceWithout=residence(baselineTaxableIncome);
 const residenceWith=residence(adjusted.adjustedTaxableIncome);
 const assessmentsWithProject=[
  tag("income-"+entityId+"-"+taxYear,entityId,taxYear,"incomeTax",projected.totalNationalTax,rule),
  tag("residence-"+entityId+"-"+taxYear,entityId,taxYear,"residenceTax",residenceWith,rule)
 ];
 const assessmentsWithoutProject=[
  tag("income-"+entityId+"-"+taxYear,entityId,taxYear,"incomeTax",baseline.totalNationalTax,rule),
  tag("residence-"+entityId+"-"+taxYear,entityId,taxYear,"residenceTax",residenceWithout,rule)
 ];
 return {entityId,entityType:"individual",taxYear,status:"estimated",breakdown,
  individualLossOffset:adjusted,baselineNational:baseline,projectNational:projected,
  incomeTaxDelta:projected.totalNationalTax-baseline.totalNationalTax,
  residenceTaxDelta:residenceWith-residenceWithout,
  assessmentsWithProject,assessmentsWithoutProject,
  notes:["Residence-tax rate and base adjustment are user-supplied estimates",
   "Pre-project income tax baseline and category offsets must be independently validated",
   "Credits/withholding/estimated prepayment and sale taxes are not included"]};
}
/**
 * Explicit scenario-by-scenario corporate national and local tax assessment.
 * Opening loss inventories may differ between the project and no-project
 * counterfactuals. They are NEVER inferred to be identical.
 */
export function assessCorporateYear({
 entityId,taxYear,baselineCorporateProfit,projectTaxItems,
 openingLossesWithProject,openingLossesWithoutProject,taxRule
}){
 required(entityId,"entityId");
 if(!Number.isInteger(taxYear)||taxYear<1900)throw new RangeError("tax year");
 const rule=taxRule?.corporate;meta(rule,taxYear);
 const localRule=taxRule?.local;meta(localRule,taxYear);
 number(baselineCorporateProfit,"baselineCorporateProfit");
 if(!Array.isArray(openingLossesWithProject)||!Array.isArray(openingLossesWithoutProject))
   throw new TypeError("both counterfactual loss registers required, including empty");
 for(const k of ["eligibleSmallCompany","defenseCorporateApplies","lossOffsetEligible","allowNewLossCarryforward"])
   actual(rule[k],k);
 number(rule.lossOffsetFraction,"lossOffsetFraction",{min:0,max:1});
 number(rule.defenseAllowance,"defenseAllowance",{min:0});
 number(rule.smallBandRate,"smallBandRate",{min:0,max:1});
 number(rule.standardRate,"standardRate",{min:0,max:1});
 number(rule.smallBandAmount,"smallBandAmount",{min:0});
 number(rule.localEntityCount,"localEntityCount",{min:1});
 if(!Number.isInteger(rule.localEntityCount))throw new RangeError("localEntityCount integer");
 const rows=normalizedItems(projectTaxItems,entityId,taxYear);
 if(rows.some(r=>r.category!=="corporate"))throw new RangeError("corporate taxpayer requires corporate income classification");
 const projectProfit=sum(rows.map(r=>r.taxableCategoryProfit));
 const compute=(profit,openingLosses)=>{
  const offset=corporateLossCarryforward({taxYear,profitBeforeCarryforward:profit,openingLosses,
   eligible:rule.lossOffsetEligible,maxOffsetFraction:rule.lossOffsetFraction,
   allowNewLossCarryforward:rule.allowNewLossCarryforward,ruleSourceUrl:rule.sourceUrl});
  const national=corporateNationalTax({taxYear,taxableIncome:offset.taxableIncome,
   eligibleSmallCompany:rule.eligibleSmallCompany,smallBandRate:rule.smallBandRate,
   standardRate:rule.standardRate,smallBandAmount:rule.smallBandAmount,
   defenseCorporateApplies:rule.defenseCorporateApplies,defenseAllowance:rule.defenseAllowance});
  const local=configuredCorporateLocalTaxes({taxYear,taxBase:offset.taxableIncome,
   corporateNationalBaseTax:national.corporateNationalTax,
   legalEntityCount:rule.localEntityCount,components:localRule.components,
   ruleSourceUrl:localRule.sourceUrl});
  return {offset,national,local,total:national.corporateTaxTotalExcludingLocal+local.total};
 };
 const without=compute(baselineCorporateProfit,openingLossesWithoutProject);
 const withProject=compute(baselineCorporateProfit+projectProfit,openingLossesWithProject);
 const assessmentsWithProject=[
  tag("corp-"+entityId+"-"+taxYear,entityId,taxYear,"corporateTax",
   withProject.national.corporateTaxTotalExcludingLocal,rule),
  tag("local-"+entityId+"-"+taxYear,entityId,taxYear,"otherTax",withProject.local.total,localRule)
 ];
 const assessmentsWithoutProject=[
  tag("corp-"+entityId+"-"+taxYear,entityId,taxYear,"corporateTax",
   without.national.corporateTaxTotalExcludingLocal,rule),
  tag("local-"+entityId+"-"+taxYear,entityId,taxYear,"otherTax",without.local.total,localRule)
 ];
 return {entityId,entityType:"corporation",taxYear,status:"estimated",projectProfit,
  baseline:without,withProject,incrementalAssessment:withProject.total-without.total,
  assessmentsWithProject,assessmentsWithoutProject,
  notes:["Corporate tax eligibility, municipality, loss vintage and statutory tax rounding are external inputs",
   "Defence special corporate tax remains separately visible in the national breakdown",
   "Local corporate tax payment months must be explicitly scheduled in the cash bridge"]};
}
export function combineAnnualIncomeTaxResults({entities,years,results}){
 if(!Array.isArray(entities)||!entities.length||!Array.isArray(years)||!years.length||!Array.isArray(results))
   throw new TypeError("entity/year and result arrays required");
 const ids=new Map();
 for(const entity of entities){
  required(entity.entityId,"entityId");
  if(!["individual","corporation"].includes(entity.entityType)||ids.has(entity.entityId))
   throw new RangeError("entity identity/type mismatch");
  ids.set(entity.entityId,entity.entityType);
 }
 const assessmentWith=[],assessmentWithout=[],seen=new Set();
 for(const result of results){
   if(result?.status!=="estimated"&&result?.status!=="computed")throw new RangeError("unresolved tax result");
   if(!ids.has(result.entityId)||ids.get(result.entityId)!==result.entityType||!years.includes(result.taxYear))
     throw new RangeError("tax result entity/type/year mismatch");
   const k=result.entityId+"|"+result.taxYear;
   if(seen.has(k))throw new RangeError("duplicate entity-year tax result");
   seen.add(k);
   assessmentWith.push(...result.assessmentsWithProject);
   assessmentWithout.push(...result.assessmentsWithoutProject);
 }
 for(const [entityId] of ids)for(const year of years)
  if(!seen.has(entityId+"|"+year))throw new RangeError("missing taxpayer-year calculation; cannot assume zero tax");
 const totalWith=sum(assessmentWith.map(x=>x.amount));
 const totalWithout=sum(assessmentWithout.map(x=>x.amount));
 return {assessmentsWithProject:assessmentWith,assessmentsWithoutProject:assessmentWithout,
  incrementalAssessment:totalWith-totalWithout,status:"estimated",
  notes:"Sale gain and VAT assessments are not included and require independent connection"};
}
