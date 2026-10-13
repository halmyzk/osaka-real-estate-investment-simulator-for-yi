import {evaluatePortfolio} from "./portfolio.mjs";

/**
 * Gate B: explicit matrix of entity-year-tax-kind assessment coverage.
 * Required zero is an explicit assessment, not an omitted row.
 * Settlement-year completeness is handled separately from assessment years.
 */
export function verifyAssessmentCoverage({entities,assessmentYears,requiredKinds,withProject,withoutProject}){
 if(!Array.isArray(entities)||!entities.length||!Array.isArray(assessmentYears)||!assessmentYears.length ||
 !Array.isArray(requiredKinds)||!Array.isArray(withProject)||!Array.isArray(withoutProject))
   throw new TypeError("nonempty entities/years plus required kinds and scenario arrays");
 const entitySet=new Set(),yearSet=new Set();
 for(const e of entities){
   if(typeof e.entityId!=="string"||!e.entityId||entitySet.has(e.entityId))throw new RangeError("duplicate/invalid entity");
   entitySet.add(e.entityId);
 }
 for(const y of assessmentYears){
   if(!Number.isInteger(y)||y<1900||yearSet.has(y))throw new RangeError("duplicate/invalid assessment year");
   yearSet.add(y);
 }
 const statuses=[];
 for(const scenario of [{name:"withProject",rows:withProject},{name:"withoutProject",rows:withoutProject}]){
   const unique=new Set();
   for(const a of scenario.rows){
     if(!entitySet.has(a.entityId)||!yearSet.has(a.taxYear)||typeof a.taxKind!=="string")
       throw new RangeError("orphan assessment entity/year/tax kind");
     const k=[a.entityId,a.taxYear,a.taxKind].join("|");
     if(unique.has(k))throw new RangeError("duplicate entity-year-kind assessment "+k);
     unique.add(k);
     if(!["computed","estimated"].includes(a.status))throw new RangeError("unresolved tax assessment "+k);
     if(typeof a.amount!=="number"||!Number.isFinite(a.amount)||a.amount<0)
       throw new RangeError("tax amount must be explicit nonnegative number");
     if(typeof a.ruleVersion!=="string"||!a.ruleVersion||
        typeof a.sourceUrl!=="string"||!a.sourceUrl.startsWith("https://"))
       throw new RangeError("tax provenance missing "+k);
   }
   for(const e of entities)for(const year of assessmentYears){
     const kinds=requiredKinds[e.entityId];
     if(!Array.isArray(kinds)||!kinds.length||new Set(kinds).size!==kinds.length)
       throw new RangeError("required tax kinds must be explicit for each entity");
     for(const kind of kinds){
       const k=[e.entityId,year,kind].join("|");
       const row=scenario.rows.find(a=>a.entityId===e.entityId&&a.taxYear===year&&a.taxKind===kind);
       statuses.push({scenario:scenario.name,entityId:e.entityId,taxYear:year,taxKind:kind,
          status:row?row.status:"incomplete",reason:row?null:"required explicit assessment missing"});
     }
   }
 }
 const missing=statuses.filter(x=>x.status==="incomplete");
 return {status:missing.length?"incomplete":statuses.some(x=>x.status==="estimated")?"estimated":"computed",
   missing,statuses,
   eligibleForTaxCashBridge:missing.length===0,
   notes:"Only configured kind/year coverage is verified, not legal completeness of the configured kind set"};
}

/**
 * Unlevered after-tax returns require independently recomputed tax scenarios
 * after debt/interest removal. Passing levered tax events is prohibited unless
 * the caller independently flags their calculation lineage as unlevered.
 */
export function evaluateUnleveredAfterTax({
 unleveredEntityLedgers,unleveredTaxEvents,taxCoverage,
 independentTaxEvidence,baseCalendarYear,holdingYears,discountRate,timeZero=[]
}){
 if(!Array.isArray(unleveredEntityLedgers)||!unleveredEntityLedgers.length||
 !Array.isArray(unleveredTaxEvents)||!Array.isArray(taxCoverage))
   throw new TypeError("unlevered ledgers, taxes and coverage required");
 if(!independentTaxEvidence||independentTaxEvidence.method!=="debtFreeTaxRecalculation"||
    independentTaxEvidence.debtInterestExcluded!==true||
    independentTaxEvidence.taxBaseRecomputed!==true||
    typeof independentTaxEvidence.evidenceId!=="string"||!independentTaxEvidence.evidenceId)
   throw new RangeError("independently recomputed debt-free tax basis is required");
 const ids=new Set(unleveredEntityLedgers.map(x=>x.entityId));
 if(ids.size!==unleveredEntityLedgers.length)throw new RangeError("duplicate entity");
 for(const x of unleveredEntityLedgers){
   if(!Array.isArray(x.ledger?.series))throw new TypeError("ledger series required");
   for(const m of x.ledger.series){
     if(m.financing!==0)throw new RangeError("unlevered ledger may not include financing flows");
   }
 }
 const covered=new Set(taxCoverage.filter(x=>["estimated","computed"].includes(x.status)).map(x=>x.entityId));
 if([...ids].some(x=>!covered.has(x)))throw new RangeError("unlevered tax coverage missing");
 const result=evaluatePortfolio({entityLedgers:unleveredEntityLedgers,taxes:unleveredTaxEvents,
  taxCoverage,baseCalendarYear,holdingYears,discountRate,timeZero});
 return {...result,valuationBasis:"unlevered-independent-after-tax",
  independentTaxEvidence:{...independentTaxEvidence},
  note:"Not derived by adding debt-service cash flows back to levered after-tax returns"};
}
