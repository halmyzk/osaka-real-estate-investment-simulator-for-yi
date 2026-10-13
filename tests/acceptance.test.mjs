import test from "node:test";
import assert from "node:assert/strict";
import {calculateOperatingMonth} from "../src/operations.mjs";
import {auditOperatingVAT,auditTaxCompleteness} from "../src/acceptance.mjs";
const op=calculateOperatingMonth({
  modelId:"M2",tenure:"lease",calendarDays:30,lodgingDays:15,rentalDays:10,selfUseDays:0,changeoverDays:1,idleDays:4,
  lodging:{unavailableDays:0,occupancy:.6,adr:30000,ancillaryRevenue:0},
  rental:{mode:"forecast",monthlyRent:300000,occupancy:.8,otherRevenue:0},
  costs:{lodgingOperating:20000,rentalOperating:5000,propertyOperating:5000,masterRent:150000},
  maintenanceCapEx:10000,deltaOperatingNWC:2000
});
const mk=(id,category,net,vat=0,vatClass="exempt")=>({
  id,category,net,vat,vatClass,gross:net+vat,
  kind:category.endsWith("Revenue")?"sale":category==="maintenanceCapEx"?"capital":"expense"
});
const lines=[mk("lodging","lodgingRevenue",270000,27000,"taxable"),mk("rental","rentalRevenue",80000),
  mk("hotel","lodgingOperating",20000,2000,"taxable"),mk("rent","rentalOperating",5000),
  mk("property","propertyOperating",5000),mk("master","masterRent",150000),
  mk("capital","maintenanceCapEx",10000,1000,"taxable")];
test("Gate A VAT net-to-gross invoice reconciliation",()=>{
 const x=auditOperatingVAT({operating:op,rows:lines});
 assert.equal(x.status,"verified");
 assert.equal(x.grossReceipts,377000);
 assert.equal(x.grossPayments,193000);
});
test("Gate A duplicate transaction / absent rent / exempt VAT rejected",()=>{
 assert.throws(()=>auditOperatingVAT({operating:op,rows:[...lines,lines[0]]}));
 assert.throws(()=>auditOperatingVAT({operating:op,rows:lines.slice(0,-1)}));
 assert.throws(()=>auditOperatingVAT({operating:op,rows:[{...lines[1],vat:8000,gross:88000},...lines.filter(x=>x.id!=="rental")]}));
});
test("Gate B each taxpayer and each tax year must cover four domains",()=>{
 const checks=["person","corporation"].flatMap(entityId=>["income","assets","vat","cashSchedule"].map(area=>({
  entityId,year:2026,area,status:"computed"
 })));
 assert.equal(auditTaxCompleteness({entities:["person","corporation"],years:[2026],checks}).status,"computed");
 assert.equal(auditTaxCompleteness({entities:["person","corporation"],years:[2026,2027],checks}).status,"incomplete");
 assert.equal(auditTaxCompleteness({entities:["person","corporation"],years:[2026],
  checks:checks.filter(x=>!(x.entityId==="corporation"&&x.area==="vat"))}).status,"incomplete");
});
test("Gate B estimated inputs do not masquerade as statutory precision",()=>{
 const areas=["income","assets","vat","cashSchedule"].map(area=>({entityId:"person",year:2026,area,status:area==="vat"?"estimated":"computed"}));
 assert.equal(auditTaxCompleteness({entities:["person"],years:[2026],checks:areas}).status,"estimated");
});
