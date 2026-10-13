import test from "node:test";
import assert from "node:assert/strict";
import {auditInterEntityTransfers,reconcileVATCash} from "../src/reconciliation.mjs";
const entities=["corp-owner","corp-operator"];
const tx=[{id:"rent",month:"2027-04",fromEntityId:"corp-operator",toEntityId:"corp-owner",amount:200000,category:"masterRent"}];
const lines=[{id:"expense",entityId:"corp-operator",month:"2027-04",category:"masterRent",amount:-200000,internalTransferId:"rent"},
  {id:"income",entityId:"corp-owner",month:"2027-04",category:"masterRent",amount:200000,internalTransferId:"rent"}];
test("actual paired entity rent lines have zero group net cash",()=>{
 const proof=auditInterEntityTransfers({entityIds:entities,transfers:tx,ledgerLines:lines});
 assert.equal(proof.internalNetCash,0);
 assert.equal(proof.proof.length,1);
 assert.equal(proof.proof[0].status,"verified");
});
test("missing, duplicate, wrong-month, wrong-entity rent transfers rejected",()=>{
 assert.throws(()=>auditInterEntityTransfers({entityIds:entities,transfers:tx,ledgerLines:lines.slice(0,1)}));
 assert.throws(()=>auditInterEntityTransfers({entityIds:entities,transfers:tx,ledgerLines:[...lines, {...lines[1],id:"other"}]}));
 assert.throws(()=>auditInterEntityTransfers({entityIds:entities,transfers:tx,ledgerLines:[lines[0],{...lines[1],month:"2027-05"}]}));
 assert.throws(()=>auditInterEntityTransfers({entityIds:entities,transfers:tx,ledgerLines:[lines[0],{...lines[1],entityId:"corp-operator"}]}));
});
test("unclaimed internal transfer is not silently discarded",()=>{
 assert.throws(()=>auditInterEntityTransfers({entityIds:entities,transfers:[],ledgerLines:lines}));
});
test("VAT gross cash and one settlement can be reconciled separately from net P/L",()=>{
 const v=reconcileVATCash({grossReceipts:1700000,grossPayments:440000,
  outputVAT:100000,inputVAT:40000,creditsAllowed:35000,expectedNetVATPayment:65000,
  expectedNetVATRefund:0,settlementPayment:65000,settlementRefund:0,actualCashNet:1195000});
 assert.equal(v.netCash,1195000);
 assert.throws(()=>reconcileVATCash({grossReceipts:1700000,grossPayments:440000,
  outputVAT:100000,inputVAT:40000,creditsAllowed:35000,expectedNetVATPayment:65000,
  expectedNetVATRefund:0,settlementPayment:130000,settlementRefund:0,actualCashNet:1195000}));
});
test("uncertain input VAT entitlement cannot exceed supported input tax",()=>{
 assert.throws(()=>reconcileVATCash({grossReceipts:100000,grossPayments:10000,
  outputVAT:10000,inputVAT:1000,creditsAllowed:2000,expectedNetVATPayment:8000,
  expectedNetVATRefund:0,settlementPayment:8000,settlementRefund:0,actualCashNet:82000}));
});
