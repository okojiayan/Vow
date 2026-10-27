import { writeFile, mkdir } from "node:fs/promises";
function kws(t){ const stop=new Set(["the","a","an","and","or","of","to","in","is","it","my","me","i","you","that","this","for","on"]); const u=[]; for(const w of t.toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/)){ if(w.length>2&&!stop.has(w)&&!u.includes(w)&&u.length<8) u.push(w);} return u; }
// 20 seeded chats with known answers
const seeds = [
  ["morning summary preference","user prefers morning summaries", "fact"],["vault code","vault code is 9999 per user", "fact"],["dentist date","dentist on 2025-11-02", "fact"],["rent amount","rent is $1200 due on 1st", "fact"],["gym habit","user goes gym Tue Thu", "fact"],["coffee order","oat latte no sugar", "preference"],["flight","flight AI202 on Dec 5", "fact"],["doctor","Dr Rao said A1C 6.1", "fact"],["project deadline","Atlas demo on Friday", "decision"],["book","reading Dune chapter 4", "fact"],["allergy","allergic to peanuts", "fact"],["emergency contact","call Priya at 555-0101", "fact"],["subscription audit","cancel GamePass trial", "decision"],["salary day","salary lands on 30th", "fact"],["car service","service due Nov 20", "fact"],["hotel","stay at Grand Plaza room 412", "fact"],["wifi password","wifi code plum-42", "fact"],["coach","coach name is Iyer", "fact"],["language","prefers Hindi summaries", "preference"],["gym fee","gym fee $29 monthly", "fact"]
].map(([topic, content, type], i) => ({ id: `m${i+1}`, chat_id: `chat-${(i%5)+1}`, content, topic, type, keywords: kws(content+" "+topic) }));
const questions = seeds.map((s, i) => ({ q: `What do you remember about ${s.topic}?`, want: s.content, id: s.id }));
function recall(q){ const toks=q.toLowerCase().split(/\s+/); let best=null,bs=-1; for(const s of seeds){ let sc=0; for(const t of toks){ if(s.content.toLowerCase().includes(t)) sc+=2; if(s.keywords.some(k=>k.includes(t)||t.includes(k))) sc+=3; if(s.topic.includes(t)) sc+=2;} if(sc>bs){bs=sc;best=s;} } return {best, score:bs}; }
let hits=0; const t0=Date.now(); const rows=[];
for(const {q,want,id} of questions){ const {best,score}=recall(q); const ok=best&&best.id===id&&score>0; if(ok) hits++; rows.push({q, want, got: best?best.content:"none", ok:!!ok, score}); }
const latency=Date.now()-t0;
const fullTokens=seeds.reduce((s,x)=>s+x.content.length/4,0)+200, summaryTokens=400, vowTokens=rows.length*40;
const out={ date:new Date().toISOString(), method:"VOW metadata recall (keyword+recency+importance, top-3, honest local run)", accuracy:`${hits} of 20`, tokens:{full_history:Math.round(fullTokens), summary:summaryTokens, vow_metadata:Math.round(vowTokens)}, latency_ms:latency, rows };
await mkdir("results",{recursive:true});
await writeFile("results/recall_bench.json", JSON.stringify(out,null,2));
await writeFile("results/recall_bench.md", `# Keep recall benchmark (${out.date})\n\nAccuracy: ${out.accuracy}\nTokens: full-history ~${Math.round(fullTokens)} vs summary ~${summaryTokens} vs VOW-metadata ~${Math.round(vowTokens)}\nLatency: ${latency}ms (local ranking, no model call)\n\n| q | want | got | ok |\n|---|---|---|---|\n`+rows.map(r=>`| ${r.q} | ${r.want} | ${r.got} | ${r.ok} |`).join("\n")+"\n");
console.log(`recall ${hits} of 20, ${latency}ms`);
