#!/usr/bin/env python3
"""Gate D foundation: JSON Schema 2020-12 and cross-field semantic tests.

Run: python -m pip install jsonschema==4.26.0
     python tests/validate_v11.py
"""
import copy
import json
from datetime import date
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

ROOT=Path(__file__).resolve().parents[1]
SCHEMA=json.loads((ROOT/"schema/v1.1.schema.json").read_text(encoding="utf-8"))
FIXTURES=json.loads((ROOT/"tests/fixtures/v1.1-schema-cases.json").read_text(encoding="utf-8"))
NUMERICS=json.loads((ROOT/"tests/fixtures/v1.1-financial-cases.json").read_text(encoding="utf-8"))
TAX=json.loads((ROOT/"tests/fixtures/v1.1-tax-cases.json").read_text(encoding="utf-8"))

def semantic_errors(data):
    errors=[]
    entities={x["id"] for x in data.get("entities",[]) if isinstance(x,dict) and "id" in x}
    units=data.get("units",[])
    def unique(items, label):
        ids=[x.get("id") for x in items if isinstance(x,dict)]
        if len(ids)!=len(set(ids)):errors.append("duplicate "+label+" ids")
    unique(data.get("entities",[]),"entity")
    unique(units,"unit")
    unique(data.get("scenarios",[]),"scenario")
    for u in units:
        uid=u.get("id","?")
        if u.get("operatorEntityId") not in entities:errors.append(uid+": unknown operator entity")
        for k in ("ownerEntityId","tenantEntityId"):
            if u.get(k) is not None and u.get(k) not in entities:errors.append(uid+": unknown "+k)
        if u.get("startDate") and u.get("operationStartDate") and u["operationStartDate"]<u["startDate"]:
            errors.append(uid+": operation before acquisition")
        seen=set();lodging_year={}
        for mo in u.get("calendar",[]):
            ym=(mo.get("year"),mo.get("month"))
            if ym in seen:errors.append(uid+": duplicate month")
            seen.add(ym)
            try:
                y,m=ym
                start=date(y,m,1)
                if m==12: following=date(y+1,1,1)
                else: following=date(y,m+1,1)
                days=(following-start).days
            except (TypeError, ValueError, OverflowError):
                errors.append(uid+": invalid calendar month")
                continue
            fields=("lodgingDays","rentalDays","selfUseDays","changeoverDays","idleDays")
            total=sum(mo.get(k,0) for k in fields)
            if total!=days:errors.append(uid+": month allocation != calendar days")
            lodging=mo.get("lodgingDays",0)
            lodging_year[y]=lodging_year.get(y,0)+lodging
            if mo.get("lodgingUnavailableWithinAllocationDays",0)>lodging:
                errors.append(uid+": unavailable nights exceed lodging allocated nights")
            if u.get("modelId")=="M1" and (mo.get("rentalDays",0)>0 or mo.get("selfUseDays",0)>0):errors.append(uid+": M1 incompatible purpose")
            if u.get("modelId")=="M2" and mo.get("selfUseDays",0)>0:errors.append(uid+": M2 incompatible self-use")
            if u.get("modelId")=="M3" and mo.get("rentalDays",0)>0:errors.append(uid+": M3 incompatible rental")
            if u.get("modelId")=="M4" and lodging>0:errors.append(uid+": M4 incompatible lodging")
        if u.get("modelId") in ("M2","M3") and any(n>180 for n in lodging_year.values()):
            errors.append(uid+": 180-day lodging allocation limit exceeded")
        for sublabel in ("assets","loans","expenses"):
            unique(u.get(sublabel,[]),uid+" "+sublabel)
        for a in u.get("assets",[]):
            if a.get("ownerEntityId") not in entities:errors.append(uid+": asset owner invalid")
        for loan in u.get("loans",[]):
            if loan.get("borrowerEntityId") not in entities:errors.append(uid+": borrower invalid")
    all_ids={data.get("portfolio",{}).get("id")} | entities | {x.get("id") for x in units}
    all_ids.update(x.get("id") for u in units for k in ("assets","loans") for x in u.get(k,[]))
    for scenario in data.get("scenarios",[]):
        keys=set()
        for o in scenario.get("overrides",[]):
            key=(o.get("scope"),o.get("targetId"),o.get("year"),o.get("month"),o.get("fieldId"))
            if key in keys:errors.append("duplicate scenario override")
            keys.add(key)
            if o.get("targetId") not in all_ids:errors.append("orphan scenario override")
    return errors

def schema_errors(instance):
    return [str(e) for e in Draft202012Validator(SCHEMA,format_checker=FormatChecker()).iter_errors(instance)]

def check_independent_arithmetic():
    cases={c["id"]:c for c in NUMERICS["cases"]}
    c=cases["case1"]
    inp=c["inputs"];exp=c["expected"]
    assert inp["availableRoomNights"]*inp["occupancy"]==exp["soldNights"]
    assert exp["soldNights"]*inp["adr"]==exp["lodgingRevenue"]
    assert exp["lodgingRevenue"]*(1-inp["otaRate"])-inp["cleanings"]*inp["cleaningUnitCost"]-inp["otherLodgingOperatingExpense"]==exp["lodgingGOP"]
    c=cases["case2"];a=c["inputs"];e=c["expected"]
    assert a["lodgingAllocationDays"]*a["lodgingOccupancy"]*a["adr"]==e["lodgingRevenue"]
    assert a["monthlyRent"]*a["rentalAllocationDays"]/a["daysInMonth"]*a["rentalOccupancy"]==e["rentalRevenue"]
    c=cases["case5"];a=c["inputs"];e=c["expected"]
    assert a["monthlyRent"]*a["rentalMonths"]*a["occupancy"]==e["annualRentRevenue"]
    assert a["salePrice"]-a["adjustedTaxBasis"]-a["sellingCosts"]==e["preReliefTaxableGain"]
    c=cases["business_apportionment"];a=c["inputs"];e=c["expected"]
    actual=a["annualSharedUtilities"]*(a["businessArea"]/a["totalArea"])*(a["actualGuestNights"]/a["yearDays"])
    assert abs(actual-e["deductibleUtilities"])<1e-8
    c=cases["unit_irr_npv"];a=c["inputs"];e=c["expected"]
    cf=a["cashFlows"];r=a["annualDiscountRate"]
    assert abs(cf[0]+cf[1]/(1+r)-e["NPV"])<1e-8
    assert abs(-cf[0]/cf[1]-(1/(1+e["IRR"])))<1e-12

def check_independent_tax_examples():
    cases={c["id"]: c for c in TAX["fixtures"]}
    a=cases["small_officer_housing_arithmetic"]
    v=a["inputs"]; e=a["expected"]
    assert abs(v["buildingFixedAssetTaxBase"]*0.002-e["buildingComponent"])<1e-8
    assert abs(12*v["floorAreaSqm"]/3.3-e["areaComponent"])<1e-8
    assert abs(v["landFixedAssetTaxBase"]*0.0022-e["landComponent"])<1e-8
    assert abs(sum((e["buildingComponent"],e["areaComponent"],e["landComponent"]))-e["rentEquivalent"])<1e-8
    assert abs(max(0,e["rentEquivalent"]-v["officerMonthlyRentPaid"])-e["officerTaxableBenefit"])<1e-8
    a=cases["luxury_officer_housing_scenario"]; v=a["inputs"]; e=a["expected"]
    assert max(0,v["assumedNormalMonthlyRent"]-v["officerActualMonthlyRent"])==e["officerTaxableBenefit"]
    a=cases["illustrative_asset_depreciation"];v=a["inputs"];e=a["expected"]
    gross=v["assetCost"]*v["annualIllustrativeDepreciationRate"]
    assert gross==e["wholeAssetAccountingDepreciation"]
    assert gross*v["businessUseShare"]==e["deductibleBusinessDepreciation"]
    assert -v["year1CashCapex"]==e["capexCashFlowYear1"]
    assert e["depreciationCashFlow"]==0
    a=cases["mixed_utilities"];v=a["inputs"];e=a["expected"]
    expense=v["grossExpense"]*(v["businessAreaSqm"]/v["totalAreaSqm"])*(v["actualGuestNights"]/v["yearDays"])
    assert abs(expense-e["deductibleExpense"])<1e-8
    assert round(expense)==e["roundedDisplayJPY"]
    a=cases["year11_exit_tax_payment"]
    assert a["inputs"]["individualTaxDueYear"]==a["inputs"]["saleYear"]+1
    assert a["expected"]["taxPaymentYear"]==a["inputs"]["individualTaxDueYear"]


def check_semantic_boundaries():
    valid=copy.deepcopy(FIXTURES["positive"])
    unit=valid["units"][0]
    unit["calendar"]=[
        {"year":2028,"month":2,"lodgingDays":15,"rentalDays":0,
         "selfUseDays":13,"changeoverDays":1,"idleDays":0}
    ]
    assert semantic_errors(valid)==[],semantic_errors(valid)  # leap year: 29 days
    unit["calendar"][0]["idleDays"]=1
    assert any("calendar days" in e for e in semantic_errors(valid))
    unit["calendar"]= [
        {"year":2028,"month":m,"lodgingDays":15,
         "rentalDays":0,"selfUseDays":0,"changeoverDays":0,
         "idleDays":date(2028+int(m==12),(m%12)+1,1).toordinal()-date(2028,m,1).toordinal()-15}
        for m in range(1,13)
    ]
    assert not semantic_errors(valid),semantic_errors(valid) # exactly 180 days
    unit["calendar"][0]["lodgingDays"]=16
    unit["calendar"][0]["idleDays"]-=1
    assert any("180-day" in e for e in semantic_errors(valid)) # 181 days


def main():
    Draft202012Validator.check_schema(SCHEMA)
    assert not semantic_errors(FIXTURES["positive"]),semantic_errors(FIXTURES["positive"])
    assert not schema_errors(FIXTURES["positive"]),schema_errors(FIXTURES["positive"])
    for item in FIXTURES["negative"]:
        obj=copy.deepcopy(FIXTURES["positive"])
        target=obj
        for part in item["path"][:-1]:target=target[part]
        target[item["path"][-1]]=item["value"]
        problems=schema_errors(obj)+semantic_errors(obj)
        assert problems,(item["id"],"invalid case unexpectedly passed")
        print("PASS reject",item["id"],problems[0][:100])
    check_independent_arithmetic()
    check_independent_tax_examples()
    check_semantic_boundaries()
    print("PASS",len(FIXTURES["negative"]),"invalid inputs rejected; positive schema and semantic checks, tax arithmetic, leap-year and 180/181-day boundaries passed")

if __name__=="__main__":main()
