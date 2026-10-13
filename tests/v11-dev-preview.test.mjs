import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {previewV11Scenario} from "../src/v11-preview-engine.mjs";
const sample=JSON.parse(readFileSync(new URL("../preview/v11-sample.json",import.meta.url),"utf8"));
const near=(x,y)=>assert.ok(Math.abs(x-y)<1e-6,`${x} not equal ${y}`);
test("Developer JSON sample uses actual Gate D document and a 2-unit, 2-entity base valuation",()=>{
 assert.equal(sample.schemaVersion,"1.1.0");
 assert.equal(sample.entities.length,2);assert.equal(sample.units.length,2);
 const r=previewV11Scenario(sample,{scenarioId:"base"});
 assert.equal(r.status,"estimated-pre-tax");
 assert.equal(r.CF0,-1120000);
 near(r.annual[0].preTaxEquityCF,2648000);
 assert.equal(r.units.find(x=>x.unitId==="osaka-m3").operating.length,12);
 assert.equal(r.units.find(x=>x.unitId==="tokyo-m4").operating.length,12);
 assert.equal(r.taxStatus,"incomplete");
 assert.equal(r.afterTax,null);
 near(r.preTax.NPV,-1120000+2648000/1.08);
});
test("Developer sample upside/downside overrides actually affect same stored financial model",()=>{
 const base=previewV11Scenario(sample,{scenarioId:"base"});
 const high=previewV11Scenario(sample,{scenarioId:"upside"});
 const low=previewV11Scenario(sample,{scenarioId:"downside"});
 near(high.annual[0].preTaxEquityCF-base.annual[0].preTaxEquityCF,216000);
 near(base.annual[0].preTaxEquityCF-low.annual[0].preTaxEquityCF,432000);
 assert.equal(high.CF0,low.CF0);
});
test("Four-tab prototype references real module, preserves legacy storage and has parseable JavaScript",()=>{
 const html=readFileSync(new URL("../preview/v11-dev.html",import.meta.url),"utf8");
 for(const id of ["business","evidence","analysis","appendix"])
  assert.match(html,new RegExp('<main id="'+id+'"'));
 assert.match(html,/import \{previewV11Scenario\} from "\.\.\/src\/v11-preview-engine\.mjs"/);
 assert.match(html,/const STORAGE_KEY="premium_re_investment_v11"/);
 assert.doesNotMatch(html,/localStorage\.(getItem|setItem|removeItem|clear)\s*\(\s*["']osaka_premium_stay_v/);
 const match=html.match(/<script type="module">([\s\S]*?)<\/script>/);
 assert.ok(match,"developer HTML must provide runnable module script");
 const js=spawnSync(process.execPath,["--input-type=module","--check"],
  {input:match[1],encoding:"utf8"});
 assert.equal(js.status,0,js.stderr);
});
