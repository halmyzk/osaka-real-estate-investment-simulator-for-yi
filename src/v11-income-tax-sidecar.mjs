/**
 * v1.1 Gate B integration boundary: externally PREPARED with/without-project
 * income / residence / corporation / capital-gain assessments.
 *
 * This is NOT a statutory tax engine: the stored portfolio's monthly taxable
 * income is not yet traced to these external assessments.  A deterministic
 * document fingerprint prevents accidental reuse after changing assumptions.
 * Its FNV hash is a CHANGE-DETECTION LABEL, not a security signature.
 *
 * VAT, gross invoice cash and consumption-tax settlement are NOT connected.
 * Output must be named afterIncomeTaxSensitivity, NEVER "full after tax".
 */
import {verifyAssessmentCoverage} from "./tax-integrity.mjs";
import {connectAnnualTaxAssessments} from "./income-tax-bridge.mjs";
const id=(x,k)=>{if(typeof x!=="string"||!x)throw new TypeError(k+" required");return x;};
export function fingerprintV11Document(document){
 if(document?.schemaVersion!=="1.1.0")throw new TypeError("v1.1 document required");
 const raw=JSON.stringify(document);
 if(!raw)throw new TypeError("serializable document required");
 let hash=0x811c9dc5;
 for(let i=0;i<raw.length;i++){hash^=raw.charCodeAt(i);hash=Math.imul(hash,0x01000193)>>>0;}
 return "v11-fnv1a32-"+hash.toString(16).padStart(8,"0");
}
const allowedTaxKinds=new Set(["incomeTax","residenceTax","corporateTax","otherTax","saleGainTax"]);
function expectedKinds(document,entityId){
 const entity=document.entities.find(x=>x.id===entityId);
 if(entity.taxpayerType==="corporation")return ["corporateTax","otherTax"];
 const kinds=["incomeTax","residenceTax"];
 if(document.units.some(x=>x.operatorEntityId===entityId&&x.tenure==="own"&&x.exit?.method!=="leaseSettlement"))
   kinds.push("saleGainTax");
 return kinds;
}
const fail=reason=>({status:"incomplete",reason,entries:[],audit:[],expectedKinds:null,incrementalTaxCF:null});
/**
 * A tax bundle remains an independent, scenario-bound sidecar; it is NOT
 * silently inserted into the canonical v1.1 persisted investment document.
 * Covers every entity and every assessment calendar year for holding period.
 */
export function compileV11IncomeTaxSidecar({document,scenarioId,sidecar}){
 if(sidecar===null||sidecar===undefined)return fail("Income-tax assessment sidecar has not been provided");
 if(!document||!Array.isArray(document.entities)||!Array.isArray(document.units)||
   !Number.isInteger(document.portfolio?.holdingYears))throw new TypeError("valid portfolio required");
 if(sidecar.version!=="v11-income-tax-sidecar-1"||
  sidecar.documentFingerprint!==fingerprintV11Document(document)||
  sidecar.scenarioId!==scenarioId)
   return fail("Tax inputs do not match this saved document and selected scenario; independent tax recalculation required");
 if(sidecar.taxBasis!=="externallyReviewedScenarioAssumption"||
    sidecar.vatTreatment!=="notConnected")
    return fail("Tax sidecar must identify scenario-assumed income tax and explicitly unresolved VAT");
 if(!Array.isArray(sidecar.withProject)||!Array.isArray(sidecar.withoutProject))
   return fail("Both project and non-project tax assessments are required");
 if(document.entities.some(e=>(e.taxYearStartMonth??1)!==1))
   return fail("Non-January tax/fiscal year requires specialized conversion not available in this preview");
 const first=Number(document.portfolio.baseDate.slice(0,4));
 const years=Array.from({length:document.portfolio.holdingYears},(_,i)=>first+i);
 const entities=document.entities.map(e=>({entityId:e.id,entityType:e.taxpayerType}));
 const requiredKinds=Object.fromEntries(entities.map(e=>[e.entityId,expectedKinds(document,e.entityId)]));
 const permitted=new Set(entities.flatMap(e=>years.flatMap(y=>requiredKinds[e.entityId].map(k=>[e.entityId,y,k].join("|")))));
 for(const list of [sidecar.withProject,sidecar.withoutProject]){
   for(const row of list){
    const key=[row.entityId,row.taxYear,row.taxKind].join("|");
    if(!permitted.has(key))return fail("Unexpected or unclassified tax head/year/entity: "+key);
    if(!allowedTaxKinds.has(row.taxKind))return fail("VAT must not enter income tax sidecar");
    if(!Array.isArray(row.paymentMonths)||!row.paymentMonths.length)
      return fail("Actual or externally reviewed forecast paymentMonths required: "+key);
    const dueYear=Number(row.taxYear);
    if(row.paymentMonths.some(month=>typeof month!=="string"||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||Number(month.slice(0,4))<dueYear))
      return fail("Tax cash settlement month is invalid: "+key);
    if(typeof row.ruleVersion!=="string"||!row.ruleVersion||!row.sourceUrl?.startsWith("https://"))
      return fail("Yearly tax legal rule and URL missing: "+key);
    if(row.status!=="estimated")return fail("Only explicitly estimated, externally reviewed scenario assessments are supported");
   }
 }
 let coverage;
 try{
   coverage=verifyAssessmentCoverage({entities,assessmentYears:years,requiredKinds,
      withProject:sidecar.withProject,withoutProject:sidecar.withoutProject});
 }catch(e){return fail("Tax coverage invalid: "+e.message);}
 if(!coverage.eligibleForTaxCashBridge)return {...fail("Tax entities and years not fully covered"),
    missing:coverage.missing,expectedKinds:requiredKinds};
 // Scenario-dependent assessments with/without must use the same matched
 // legal rule and payment schedule. Otherwise schedule changes invent savings.
 const counterparty=new Map(sidecar.withoutProject.map(x=>
   [[x.entityId,x.taxYear,x.taxKind].join("|"),x]));
 for(const x of sidecar.withProject){
   const other=counterparty.get([x.entityId,x.taxYear,x.taxKind].join("|"));
   if(!other||x.ruleVersion!==other.ruleVersion||x.sourceUrl!==other.sourceUrl||
      JSON.stringify(x.paymentMonths)!==JSON.stringify(other.paymentMonths)||
      JSON.stringify(x.paymentWeights??null)!==JSON.stringify(other.paymentWeights??null))
      return fail("Counterfactual tax rule or payment timing mismatch: "+x.taxKind);
 }
 try{
   const bridge=connectAnnualTaxAssessments({entities,
      assessmentsWithProject:sidecar.withProject,
      assessmentsWithoutProject:sidecar.withoutProject});
   return {status:"estimated",scenarioId,entries:bridge.entries,audit:bridge.audit,
     incrementalTaxCF:bridge.incrementalTaxCF,expectedKinds:requiredKinds,
     taxYears:years,vatStatus:"incomplete",
     warnings:[
       "Tax amounts are externally prepared scenario assumptions, not generated from this portfolio's taxable operating profit",
       "Only individual/corporate income, resident and covered sale-gain taxes are included; VAT and gross cash are not reconciled",
       "Payment months are externally reviewed scenario inputs and not proof of actual remittance"
     ]};
 }catch(e){return fail("Tax payment reconciliation failed: "+e.message);}
}
