/**
 * Asset-specific depreciation eligibility input gate.
 * This checks documentary completeness only; it does not certify law or
 * compute a statutory rate from a user-entered useful life.
 */
const date=s=>{
 if(typeof s!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new RangeError("ISO date required");
 const d=new Date(s+"T00:00:00Z");
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)throw new RangeError("invalid date");
 return s;
};
const number=(x,k)=>{if(typeof x!=="number"||!Number.isFinite(x))throw new TypeError(k+" must be finite");return x;};
export function verifyDepreciationPrerequisites({asset,taxYear,rule}){
 if(!Number.isInteger(taxYear)||taxYear<1900)throw new RangeError("tax year");
 if(!asset||!rule)throw new TypeError("asset and effective tax rule required");
 const findings=[];
 if(!asset.id||!asset.ownerEntityId||!asset.unitId)findings.push("asset or owner identity missing");
 const acquired=date(asset.acquisitionDate),inService=date(asset.inServiceDate);
 if(inService<acquired)findings.push("in-service date predates acquisition");
 number(asset.taxBasis,"taxBasis");
 if(asset.taxBasis<0)findings.push("negative acquisition basis");
 if(!["land","building","buildingEquipment","leaseholdImprovement","furniture","appliance","other"].includes(asset.category))
   findings.push("unsupported asset category");
 if(!["straightLine","decliningBalance","nonDepreciable"].includes(asset.method))
   findings.push("unsupported method");
 if(asset.category==="land"&&asset.method!=="nonDepreciable")findings.push("land cannot depreciate");
 if(asset.category!=="land"&&asset.method==="nonDepreciable"&&asset.nonDepreciableReason===undefined)
   findings.push("non-depreciable treatment requires a reason");
 if(asset.method!=="nonDepreciable"){
   if(!Number.isInteger(asset.usefulLifeYears)||asset.usefulLifeYears<1)findings.push("useful life missing");
   if(typeof rule.annualRate!=="number"||!Number.isFinite(rule.annualRate)||rule.annualRate<=0||rule.annualRate>1)
     findings.push("method-specific annual rate missing");
 }
 if(rule.assetCategory!==asset.category||rule.method!==asset.method)
   findings.push("asset category or method differs from rule");
 if(!rule.validFrom||!rule.validUntil||date(rule.validFrom)>acquired||date(rule.validUntil)<acquired)
   findings.push("rule is not valid at acquisition date");
 if(!rule.sourceUrl||!rule.sourceUrl.startsWith("https://"))findings.push("rule provenance missing");
 if(!["verifiedForScenario","scenarioAssumption","unverified"].includes(rule.applicability))
   findings.push("rule applicability unknown");
 if(rule.applicability==="unverified")findings.push("tax rule applicability not established");
 if(inService.slice(0,4)>String(taxYear))findings.push("in-service later than tax year");
 const status=findings.length?"incomplete":rule.applicability==="scenarioAssumption"?"estimated":"computed";
 return {assetId:asset.id,taxYear,status,findings,
   canComputeNumericalDepreciation:status!=="incomplete",
   note:"Confirmed eligibility flag requires independent documentary/legal review"};
}
