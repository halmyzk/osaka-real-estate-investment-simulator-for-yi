/**
 * Gate B annual-tax assessment -> dated incremental income-tax cash flow.
 * Tax amounts are precomputed by separate, explicitly configured legal-rule
 * modules. This module NEVER guesses tax rate or lawful filing eligibility.
 *
 * VAT settlement must be booked via the VAT-inclusive cash ledger and must
 * NOT be included here, avoiding duplicate consumption-tax cash.
 */
import {planTaxPayments,incrementalTaxEvents} from "./tax.mjs";
const finite=(v,k)=>{if(typeof v!=="number"||!Number.isFinite(v))throw new TypeError(k+" must be finite number");return v;};
const nonneg=(v,k)=>{finite(v,k);if(v<0)throw new RangeError(k+" cannot be negative");return v;};
const validEntity=e=>{
 if(!e||typeof e.entityId!=="string"||!e.entityId||!["individual","corporation"].includes(e.entityType))
   throw new TypeError("entity identity and tax type required");
 return e;
};
const legalKinds=new Set(["incomeTax","residenceTax","corporateTax","saleGainTax","otherTax"]);
const mandatoryMeta=a=>{
 if(!Number.isInteger(a.taxYear)||a.taxYear<1900)throw new RangeError("taxYear required");
 if(!legalKinds.has(a.taxKind))throw new RangeError("VAT or unknown tax kind cannot be booked here");
 if(!["computed","estimated"].includes(a.status))throw new RangeError("unresolved tax assessment");
 if(typeof a.ruleVersion!=="string"||!a.ruleVersion||typeof a.sourceUrl!=="string"||!a.sourceUrl.startsWith("https://"))
   throw new RangeError("tax year rule provenance required");
 nonneg(a.amount,"assessed amount");
 if(typeof a.id!=="string"||!a.id)throw new TypeError("assessment id required");
};
export function connectAnnualTaxAssessments({
 entities,assessmentsWithProject,assessmentsWithoutProject
}){
 if(!Array.isArray(entities)||!Array.isArray(assessmentsWithProject)||!Array.isArray(assessmentsWithoutProject))
   throw new TypeError("all three arrays required");
 const entityTypes=new Map();
 for(const e of entities){validEntity(e);if(entityTypes.has(e.entityId))throw new RangeError("duplicate entity");entityTypes.set(e.entityId,e.entityType);}
 if(entityTypes.size===0)throw new RangeError("entities missing");
 const eventSets={withProject:[],withoutProject:[]},audit=[];
 for(const [which,items] of [["withProject",assessmentsWithProject],["withoutProject",assessmentsWithoutProject]]){
   const seen=new Set();
   for(const a of items){
     mandatoryMeta(a);
     if(!entityTypes.has(a.entityId))throw new RangeError("unknown entity in assessment");
     const unique=a.entityId+"|"+a.id;
     if(seen.has(unique))throw new RangeError("duplicate assessment");
     seen.add(unique);
     const type=entityTypes.get(a.entityId);
     if(type==="corporation"&&["incomeTax","residenceTax","saleGainTax"].includes(a.taxKind))
       throw new RangeError("personal tax on corporation");
     if(type==="individual"&&a.taxKind==="corporateTax")throw new RangeError("corporate tax on individual");
     const plan=planTaxPayments({entityId:a.entityId,entityType:type,taxYear:a.taxYear,
       fiscalYearEndMonth:a.fiscalYearEndMonth??12,
       assessments:[{id:a.id,taxKind:a.taxKind,amount:a.amount,paymentMonths:a.paymentMonths,paymentWeights:a.paymentWeights}]});
     eventSets[which].push(...plan.entries);
     audit.push({entityId:a.entityId,taxYear:a.taxYear,taxKind:a.taxKind,
       assessmentId:a.id,sourceUrl:a.sourceUrl,ruleVersion:a.ruleVersion,
       status:a.status,scenario:which,paymentMonths:plan.entries.map(x=>x.month)});
   }
 }
 const incremental=incrementalTaxEvents(eventSets);
 // A complete annual tax assessment must be supplied for both situations,
 // including explicitly assessed zero. Absence must not masquerade as zero.
 const withKeys=new Set(audit.filter(x=>x.scenario==="withProject").map(x=>[x.entityId,x.taxYear,x.taxKind].join("|")));
 const withoutKeys=new Set(audit.filter(x=>x.scenario==="withoutProject").map(x=>[x.entityId,x.taxYear,x.taxKind].join("|")));
 const unmatched=[...new Set([...withKeys,...withoutKeys])].filter(k=>!withKeys.has(k)||!withoutKeys.has(k));
 if(unmatched.length)throw new RangeError("Baseline or project tax assessment missing: "+unmatched.join(","));
 return {entries:incremental.entries,incrementalTaxCF:incremental.incrementalTaxCF,
   audit,status:audit.some(x=>x.status==="estimated")?"estimated":"computed",
   note:"Both tax scenarios assessed; VAT events must be booked separately, and statutory rule eligibility externally validated"};
}
