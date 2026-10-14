import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectV11Draft,parseV11Draft,saveV11Draft,restoreV11Draft,serializeV11Draft,V11_DRAFT_KEY} from "../src/v11-draft-storage.mjs";
const source=JSON.parse(readFileSync(new URL("../preview/v11-sample.json",import.meta.url),"utf8"));
const clone=x=>structuredClone(x);
class Storage{
 data=new Map();touched=[];
 getItem(k){this.touched.push(["get",k]);return this.data.has(k)?this.data.get(k):null}
 setItem(k,v){this.touched.push(["set",k]);this.data.set(k,String(v))}
 removeItem(k){this.touched.push(["remove",k]);this.data.delete(k)}
}
test("Browser preflight validates real schema-shaped 2-entity draft, with genuinely incomplete financial inputs allowed",()=>{
 const d=clone(source);
 const ok=inspectV11Draft(d);
 assert.equal(ok.status,"structurallyReviewed");
 assert.equal(ok.fullJsonSchemaValidated,false);
 d.units[0].fields.H.H01.value=null;
 assert.equal(inspectV11Draft(d).status,"structurallyReviewed");
 assert.equal(parseV11Draft(serializeV11Draft(d)).document.units[0].fields.H.H01.value,null);
});
test("Explicit save uses v1.1 key only, confirms read-back and restores an isolated clone",()=>{
 const storage=new Storage();
 storage.data.set("osaka_premium_stay_v3","immutable-old-v3");
 storage.data.set("osaka_premium_stay_v2","immutable-old-v2");
 storage.data.set("osaka_premium_stay_v1","immutable-old-v1");
 const x=saveV11Draft(storage,source);
 assert.equal(x.status,"saved");assert.equal(x.readBackVerified,true);
 const restored=restoreV11Draft(storage);
 assert.equal(restored.status,"restored");assert.deepEqual(restored.document,source);
 restored.document.units[0].name="changed";
 assert.notEqual(storage.data.get(V11_DRAFT_KEY).includes('"changed"'),true);
 for(const key of ["osaka_premium_stay_v3","osaka_premium_stay_v2","osaka_premium_stay_v1"]){
  assert.equal(storage.data.get(key),"immutable-old-"+key.slice(-2));
  assert.ok(!storage.touched.some(x=>x[1]===key));
 }
});
test("Invalid JSON, bad version, duplicate unit, orphan and leap-month day mismatch cannot overwrite saved draft",()=>{
 const storage=new Storage();
 saveV11Draft(storage,source);
 const old=storage.data.get(V11_DRAFT_KEY);
 for(const invalid of [
  "{bad",JSON.stringify({...source,schemaVersion:"1.0.0"}),
  JSON.stringify({...source,units:[...source.units,source.units[0]]}),
  JSON.stringify({...source,units:[{...source.units[0],operatorEntityId:"missing"},source.units[1]]}),
  JSON.stringify({...source,units:[{...source.units[0],
   calendar:source.units[0].calendar.map((m,i)=>i===0?{...m,selfUseDays:99}:m)},source.units[1]]}),
  JSON.stringify({...source,calculatedResults:{NPV:999}})
 ]){
  assert.throws(()=>parseV11Draft(invalid));
  assert.equal(storage.data.get(V11_DRAFT_KEY),old);
 }
});
test("Failed storage or read-back mismatch preserve original saved value; no false save success",()=>{
 const previous=serializeV11Draft(source);
 const storage=new Storage();storage.setItem(V11_DRAFT_KEY,previous);
 let tries=0;
 storage.setItem=(key,value)=>{
  tries++;if(tries===1)throw new Error("QuotaExceededError");
  storage.data.set(key,value);
 };
 assert.throws(()=>saveV11Draft(storage,source),/Quota/);
 assert.equal(storage.data.get(V11_DRAFT_KEY),previous);
 const corrupt=new Storage();corrupt.setItem(V11_DRAFT_KEY,previous);
 const savedGet=corrupt.getItem.bind(corrupt);
 let getIndex=0;
 corrupt.getItem=(key)=>{getIndex++;return getIndex===2?"corrupt-readback":savedGet(key)};
 assert.throws(()=>saveV11Draft(corrupt,source),/read-back/);
 assert.equal(corrupt.data.get(V11_DRAFT_KEY),previous);
});
test("Scenario duplicate override and malformed field source are rejected before import",()=>{
 const d=clone(source);d.scenarios[0].overrides=[
  {scope:"unit",targetId:"osaka-m3",fieldId:"H01",field:{value:100,"unit":"JPY_per_room_night",sourceType:"userAssumption"}},
  {scope:"unit",targetId:"osaka-m3",fieldId:"H01",field:{value:100,"unit":"JPY_per_room_night",sourceType:"userAssumption"}}
 ];
 assert.throws(()=>inspectV11Draft(d),/duplicate/);
 const malformed=clone(source);
 malformed.portfolio.fields.P04.sourceType="notSupported";
 assert.throws(()=>inspectV11Draft(malformed),/metadata/);
 assert.equal(restoreV11Draft(new Storage()).status,"notFound");
});
