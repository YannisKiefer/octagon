"use client";
import { useState } from "react";
// ponytail: one page, one chat — phone = agent. No SaaS maze. Grok 1:1, Ralf-style.

const DEVICES = [
  {id:"phone1", prefix:"Alpha", phone:1, sub:"warmed 3421 swipes · 812 likes"},
  {id:"phone2", prefix:"Bravo", phone:2, sub:"posting · 654 likes"},
  {id:"phone3", prefix:"Charlie", phone:3, sub:"idle · 120 likes"},
  {id:"phone4", prefix:"Delta", phone:4, sub:"warmed 1765 swipes · 432 likes"},
];
const HEALTH: Record<string,{state:string; swipes:number; likes:number; jitter:number}> = {
  phone1:{state:"warmup", swipes:3421, likes:812, jitter:0.34},
  phone2:{state:"posting", swipes:2893, likes:654, jitter:0.31},
  phone3:{state:"idle", swipes:452, likes:120, jitter:0.12},
  phone4:{state:"warmup", swipes:1765, likes:432, jitter:0.28},
};
const EVENTS: Record<string,{ts:string; text:string}[]> = {
  phone1:[
    {ts:"Gestern 21:05", text:"US evening: 0 replies. Nothing cleared 12x that was actually our ICP (closest was a Turkish Trendyol tax rant, skipped)."},
    {ts:"Gestern 21:05", text:"Shipped one original off the unused Drobin angle instead:\nhttps://x.com/yannis1kiefer/status/2092327533945692226"},
    {ts:"Gestern 23:02", text:"Last hourly: still no gold. Didn't pad. Original already went out this hour so nothing else to ship."},
    {ts:"Gestern 23:18", text:"Ran the nightly learn pass and this time the numbers were clear enough to actually change the playbook (first accepted edit since Sunday).\n\nHarvested all 41 ships. Replies: median 14 views, best 324. Fillers in dead hours are worth nothing.\n\nTwo changes: zero-gold hour now means no post at all (slot goes to follows), and hunt widened to FR/DE/ES. Cron :17 / 20:27."},
  ],
  phone2:[
    {ts:"Gestern 21:05", text:"Warmup sweep Bravo: 2,893 swipes, 654 likes, jitter 0.31 — healthy. Like rate 22%."},
    {ts:"Gestern 22:44", text:"Parity check: z-score 0.8 — human. like/save 3.3, no flag."},
    {ts:"Gestern 23:02", text:"Posting queue: 2 drafts waiting for next Lücke (00:17). Nächster Slot in 14 Min."},
  ],
  phone3:[
    {ts:"Samstag", text:"Idle — no warmup. Tap Start to wake Charlie. Last: 452 swipes, 120 likes. Needs warmup before posting."},
  ],
  phone4:[
    {ts:"Gestern 21:05", text:"Posting Delta: 18 of 18 posted. You didn't touch it."},
    {ts:"Gestern 21:05", text:"Warmup sweep Delta: 1,765 swipes, 432 likes, jitter 0.28 — healthy"},
    {ts:"Gestern 23:18", text:"Ran nightly learn — zero-gold hour = no post at all. Hunt widened to FR/DE/ES. Cron :17 / 20:27."},
  ],
};
const ROUTINEN: Record<string,{t:string; s:string}[]> = {
  phone1:[
    {t:"X morning trend + drafts", s:"Jeden Tag um 8:27"},
    {t:"Warmup sweep", s:"Laufend · 3,421 swipes"},
    {t:"Auto-post", s:"Nächste Lücke 00:17"},
    {t:"Parity check", s:"Jede Stunde, :17"},
    {t:"Nightly learn", s:"Jeden Tag um 23:00"},
  ],
  phone2:[
    {t:"Warmup sweep", s:"2 queued"},
    {t:"X hourly human post", s:"Jede Stunde, 9:17–20:17"},
    {t:"Parity check", s:"Jede Stunde, :17"},
  ],
  phone3:[
    {t:"Warmup sweep", s:"Idle — Start drücken"},
    {t:"X midday hijack check", s:"Jeden Tag um 13:14"},
  ],
  phone4:[
    {t:"Warmup sweep", s:"Laufend"},
    {t:"Auto-post", s:"Nächste Lücke"},
    {t:"X US-evening reply wave", s:"Jeden Tag um 20:27"},
    {t:"Nightly learn", s:"23:00"},
  ],
};

export default function OctagonGrok(){
  const [sel, setSel] = useState("phone1");
  const [showPhone, setShowPhone] = useState(false);
  const cur = DEVICES.find(d=>d.id===sel) || DEVICES[0];
  const h = HEALTH[sel];
  const evs = EVENTS[sel] || [];
  const rous = ROUTINEN[sel] || ROUTINEN.phone1;
  const active = 3;
  return (
    <div className="flex h-screen bg-[#010409] text-[#e6edf3] overflow-hidden font-[Inter,ui-sans-serif]">
      {/* LEFT */}
      <aside className="w-[280px] bg-[#0d1117] border-r border-[#21262d] flex flex-col">
        <div className="h-[56px] px-4 flex items-center justify-between border-b border-[#21262d]">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#f85149] inline-block" />
            <span className="font-mono font-bold text-sm tracking-tight">octagon</span>
            <span className="text-[10px] text-[#8b949e] font-mono">FARM {active}/{DEVICES.length} LIVE</span>
          </div>
          <div className="w-7 h-7 rounded-full bg-[#21262d] grid place-items-center text-[10px] font-bold">YK</div>
        </div>
        <div className="px-3 py-3">
          <div className="relative">
            <input placeholder="Suchen" className="w-full bg-[#010409] border border-[#30363d] rounded-md pl-8 pr-3 py-1.5 text-sm placeholder:text-[#8b949e] focus:outline-none focus:border-[#8b949e]" />
            <span className="absolute left-2.5 top-1.5 text-[#8b949e]">⌕</span>
          </div>
        </div>
        <div className="flex-1 overflow-auto px-2 space-y-1">
          {DEVICES.map(d=>{
            const hs=HEALTH[d.id];
            const isSel=d.id===sel;
            const dot = hs.state==="warmup" ? "bg-emerald-500 animate-pulse" : hs.state==="posting" ? "bg-sky-500 animate-pulse" : hs.state==="idle" ? "bg-[#8b949e]" : "bg-amber-500";
            return (
              <button key={d.id} onClick={()=>setSel(d.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left ${isSel ? "bg-[#161b22] border border-[#30363d]" : "hover:bg-[#161b22] border border-transparent"}`}>
                <span className={`w-2 h-2 rounded-full ${dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium leading-none flex items-center gap-2">
                    {d.prefix} <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#21262d] text-[#8b949e] font-mono">{d.id}</span>
                  </div>
                  <div className="text-xs text-[#8b949e] truncate">{d.sub}</div>
                </div>
                <span className="text-[11px] text-[#8b949e] font-mono">{d.id==="phone3"?"Samstag":"Gestern"}</span>
              </button>
            );
          })}
          <div className="px-3 py-2 text-[11px] font-mono text-[#8b949e] border-t border-[#21262d] mt-2 pt-3">System</div>
          <div className="flex items-center gap-3 px-3 py-2 text-sm text-[#8b949e]">
            <span className="w-6 h-6 rounded-full bg-[#21262d] grid place-items-center text-[10px]">◈</span> Health <span className="text-xs ml-auto">Farm 4.2 Active</span>
          </div>
          <div className="flex items-center gap-3 px-3 py-2 text-sm text-[#8b949e]">
            <span className="w-6 h-6 rounded-full bg-[#21262d] grid place-items-center text-[10px]">◈</span> Parity <span className="text-xs ml-auto">{h.jitter} jitter</span>
          </div>
        </div>
        <div className="p-3 border-t border-[#21262d] space-y-2">
          <button onClick={()=>alert(`Warm ${cur.prefix} for 30m — hub would warm`)} className="w-full bg-[#f85149] text-white rounded-md py-2 text-sm font-bold hover:bg-[#e7463d]">▶ Start farm</button>
          <button onClick={()=>alert(`Drop video for ${cur.prefix}`)} className="w-full bg-[#21262d] border border-[#30363d] rounded-md py-2 text-sm font-medium">Drop video</button>
        </div>
      </aside>

      {/* CENTER */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#010409]">
        <div className="h-[56px] px-6 flex items-center justify-between border-b border-[#21262d] bg-[#0d1117]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#21262d] grid place-items-center text-sm">{cur.prefix[0]}</div>
            <div>
              <div className="text-sm font-bold leading-none flex items-center gap-2">{cur.prefix} <span className="text-xs font-mono text-[#8b949e]">{cur.id} · 863180542284</span></div>
              <div className="text-xs font-mono text-[#8b949e]">{h.state} · {h.swipes} swipes · {h.likes} likes</div>
            </div>
          </div>
          <div className="text-xs font-mono text-[#8b949e]">Gestern 21:05</div>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-4">
          {evs.map((e,i)=>(
            <div key={i} className="max-w-[720px]">
              <div className="text-[11px] font-mono text-[#8b949e] mb-1 ml-1">{e.ts}</div>
              <div className="rounded-2xl bg-[#21262d] border border-[#30363d] px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap">{e.text}</div>
            </div>
          ))}
          <div className="text-center py-3">
            <span className="text-[11px] font-mono text-[#8b949e] bg-[#0d1117] border border-[#21262d] rounded-full px-3 py-1">Aktualisiert: Routine {cur.prefix} hourly human post</span>
          </div>
          <div className="max-w-[720px] ml-auto">
            <div className="rounded-2xl bg-[#1f2937] border border-[#30363d] px-4 py-3 text-[14px] leading-relaxed">
              Ran the nightly learn pass and this time the numbers were clear enough to actually change the playbook (first accepted edit since Sunday). Two changes applied.
            </div>
            <div className="text-[11px] font-mono text-[#8b949e] mt-1 text-right">Gestern 23:18 · Farm</div>
          </div>
        </div>

        <div className="p-4 border-t border-[#21262d] bg-[#0d1117]">
          <div className="flex items-center gap-3 bg-[#010409] border border-[#30363d] rounded-full px-3 py-2">
            <button className="w-8 h-8 rounded-full bg-[#21262d] grid place-items-center text-[#8b949e]">+</button>
            <input placeholder={`Nachricht an ${cur.prefix}`} className="flex-1 bg-transparent outline-none text-sm placeholder:text-[#8b949e]" />
            <button className="w-8 h-8 rounded-full bg-white text-black grid place-items-center">🎤</button>
          </div>
          <div className="text-[11px] font-mono text-[#8b949e] text-center mt-2">Chat with {cur.prefix} — like OpenClaw agent. Say "warm {cur.prefix.toLowerCase()} 30m" or drop a video.</div>
        </div>
      </main>

      {/* RIGHT */}
      <aside className="w-[360px] bg-[#0d1117] border-l border-[#21262d] hidden xl:flex flex-col">
        <div className="h-[56px] px-4 flex items-center justify-between border-b border-[#21262d]">
          <span className="text-sm font-bold">Bildschirm von {cur.prefix}</span>
          <span className="text-[#8b949e]">⚙︎</span>
        </div>
        <div className="p-4">
          <button onClick={()=>setShowPhone(true)} className="w-full aspect-[4/3] rounded-xl bg-[#161b22] border border-[#30363d] p-3 flex flex-col hover:border-[#8b949e] transition-colors text-left">
            <div className="flex-1 grid place-items-center">
              <div className="text-center">
                <div className="w-12 h-12 mx-auto rounded-full border-2 border-[#30363d] border-t-white animate-spin mb-3" />
                <div className="text-xs font-mono text-[#8b949e]">{cur.prefix} · {h.state}</div>
                <div className="text-[11px] font-mono text-emerald-400 mt-1">{h.swipes} swipes · {h.likes} likes</div>
                <div className="text-[10px] font-mono text-[#6e7681] mt-2">Click to open phone</div>
              </div>
            </div>
            <div className="flex gap-2 text-[11px] font-mono">
              <span className="px-2 py-1 rounded bg-[#21262d] border border-[#30363d]">{h.state}</span>
              <span className="px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">jitter {h.jitter}</span>
            </div>
          </button>
          <div className="text-xs font-mono text-[#8b949e] mt-2 text-center">Live preview — real iPhone {cur.id} · Click to see what {cur.prefix} sees</div>
        </div>
        <div className="flex-1 overflow-auto px-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold">Routinen</span>
            <button className="text-[#8b949e] text-lg leading-none">+</button>
          </div>
          <div className="space-y-1">
            {rous.map(r=>(
              <div key={r.t} className="flex items-start gap-3 py-2.5 px-2 rounded hover:bg-[#161b22]">
                <span className="mt-0.5 w-5 h-5 rounded-full border border-emerald-500 text-emerald-500 grid place-items-center text-[11px]">◐</span>
                <div className="flex-1">
                  <div className="text-sm font-medium leading-none">{r.t}</div>
                  <div className="text-xs text-[#8b949e]">{r.s}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 p-3 rounded-lg bg-[#161b22] border border-[#30363d]">
            <div className="text-xs font-mono text-[#8b949e]">Agent {cur.prefix}</div>
            <div className="text-sm font-bold">{cur.prefix} — {h.state}</div>
            <div className="text-xs text-[#8b949e] mt-1">Talk to this phone. It works 24/7. Like Hermes/OpenClaw but for your farm.</div>
            <button onClick={()=>setSel(DEVICES[(DEVICES.findIndex(d=>d.id===sel)+1)%DEVICES.length].id)} className="mt-3 w-full bg-[#21262d] border border-[#30363d] rounded-md py-1.5 text-xs font-medium">Switch to {(DEVICES[(DEVICES.findIndex(d=>d.id===sel)+1)%DEVICES.length].prefix)}</button>
          </div>
        </div>
      </aside>

      {showPhone && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 grid place-items-center p-8" onClick={()=>setShowPhone(false)}>
          <div className="bg-[#0d1117] border border-[#30363d] rounded-2xl max-w-[360px] w-full overflow-hidden" onClick={e=>e.stopPropagation()}>
            <div className="h-10 px-4 flex items-center justify-between border-b border-[#21262d]">
              <span className="text-sm font-bold">{cur.prefix} — {cur.id} screen</span>
              <button onClick={()=>setShowPhone(false)} className="w-7 h-7 rounded-full bg-[#21262d] grid place-items-center text-[#8b949e]">✕</button>
            </div>
            <div className="aspect-[9/19.5] bg-[#010409] grid place-items-center p-4">
              <div className="w-full h-full rounded-[2rem] border-4 border-[#21262d] bg-[#161b22] grid place-items-center">
                <div className="text-center p-6">
                  <div className="w-10 h-10 mx-auto rounded-full border-2 border-[#30363d] border-t-white animate-spin mb-3" />
                  <div className="text-sm font-mono text-white">{cur.prefix} live view</div>
                  <div className="text-xs font-mono text-[#8b949e] mt-1">{h.state} · {h.swipes} swipes</div>
                  <div className="text-[11px] font-mono text-emerald-400 mt-3">Hermes has full context — screen, health, events. Ask it anything.</div>
                </div>
              </div>
            </div>
            <div className="p-3 border-t border-[#21262d] flex gap-2">
              <button onClick={()=>{setShowPhone(false); alert(`Hermes: what do you want ${cur.prefix} to do?`);}} className="flex-1 bg-[#f85149] text-white rounded-md py-2 text-sm font-bold">Talk to {cur.prefix}</button>
              <button onClick={()=>setShowPhone(false)} className="px-4 bg-[#21262d] border border-[#30363d] rounded-md text-sm">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
