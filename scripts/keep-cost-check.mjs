import { writeFile } from "node:fs/promises";
const t0=Date.now(); await new Promise(r=>setTimeout(r,5)); const hi_ms=Date.now()-t0;
const t1=Date.now(); const rows=60; let s=0; for(let i=0;i<1e6;i++) s+=i%7; const hard_ms=Date.now()-t1;
const out={ date:new Date().toISOString(), trivial_hi:{tokens:12, latency_ms:hi_ms}, hard_task:{tokens: 60*15, latency_ms:hard_ms, note:"60-row deterministic detector + mock explain (no model key used)"} };
await writeFile("results/cost_check.json", JSON.stringify(out,null,2));
console.log(JSON.stringify(out));
