"use client";
import { useState } from "react";

// 1:1 clone of the reference chat window. Same fonts, colors, rounding, boxes,
// lines, flows, places. Only the copy is changed to the phone-farm meaning.
// Each phone is an agent (Hermes Bot). Click a croc -> chat with that phone.
// Click the screen preview -> open the phone and see what the agent sees.

type Croc = { id: string; name: string; tag?: string; emoji: string; bg: string; preview: string; time: string };
type Msg = { ts: string; text: string; side: "left" | "right" };
type Routine = { title: string; schedule: string };

const CROCS: Croc[] = [
  { id: "phone1", name: "Alpha", tag: "Warmup", emoji: "🤖", bg: "#3a3a3c", preview: "Ran the nightly learn pass and changed the playbook…", time: "Gestern" },
  { id: "phone2", name: "Bravo", emoji: "⚡", bg: "#7d5cf6", preview: "18 of 18 posted. You didn't touch it.", time: "Gestern" },
  { id: "phone3", name: "Charlie", emoji: "💤", bg: "#3b82f6", preview: "Idle — tap Start and I warm up for 30 minutes.", time: "Gestern" },
  { id: "phone4", name: "Delta", emoji: "🔥", bg: "#f59e0b", preview: "Warmup done. Next post slot at 20:27.", time: "Samstag" },
];

const MESSAGES: Record<string, Msg[]> = {
  phone1: [
    { ts: "Gestern 21:05", side: "left", text: "US evening: 0 replies. Nothing cleared 12x that was actually our ICP (closest was a Turkish Trendyol tax rant, skipped)." },
    { ts: "Gestern 21:05", side: "left", text: "Shipped one original off the unused Drobin angle instead:\nhttps://x.com/yannis1kiefer/status/2092327533945692226" },
    { ts: "Gestern 23:02", side: "left", text: "Last hourly: still no gold. Didn't pad. Original already went out this hour so nothing else to ship." },
    { ts: "Gestern 23:18", side: "right", text: "Ran the nightly learn pass and this time the numbers were clear enough to actually change the playbook (first accepted edit since Sunday).\n\nHarvested all 41 ships. Replies: median 14 views, best 324. Originals: median 6 views, best 13. Top 5 posts are all replies, every original is at the bottom.\n\nTwo changes: zero-gold hour now means no post at all (slot goes to follows, likes and harder scouting), and I'm widening the hunt to French/German/Spanish ICP posts.\n\nCron minutes re-rolled too, hourly to :17 and the evening wave to 20:27." },
  ],
  phone2: [
    { ts: "Gestern 21:05", side: "left", text: "Warmup sweep Bravo: 2,893 swipes, 654 likes, jitter 0.31 — healthy. Like rate 22%." },
    { ts: "Gestern 22:44", side: "left", text: "Parity check: z-score 0.8 — human. Like/save 3.3, no flag." },
    { ts: "Gestern 23:02", side: "left", text: "Posting queue: 2 drafts waiting for the next open slot (00:17)." },
  ],
  phone3: [
    { ts: "Samstag", side: "left", text: "Idle — no warmup yet. Tap Start and I warm up for 30 minutes. Last run: 452 swipes, 120 likes." },
  ],
  phone4: [
    { ts: "Gestern 21:05", side: "left", text: "Posting Delta: 18 of 18 posted. You didn't touch it." },
    { ts: "Gestern 21:05", side: "left", text: "Warmup sweep Delta: 1,765 swipes, 432 likes, jitter 0.28 — healthy." },
    { ts: "Gestern 23:18", side: "left", text: "Nightly learn: zero-gold hour now means no post at all. Hunt widened to FR/DE/ES. Cron :17 / 20:27." },
  ],
};

const ROUTINES: Record<string, Routine[]> = {
  phone1: [
    { title: "Warmup sweep", schedule: "Jeden Tag um 8:27" },
    { title: "Auto-post", schedule: "Jede Stunde, 9:17 – 20:17" },
    { title: "Parity check", schedule: "Jeden Tag um 13:14" },
    { title: "Nightly learn", schedule: "Jeden Tag um 23:00" },
  ],
  phone2: [
    { title: "Warmup sweep", schedule: "2 queued" },
    { title: "Auto-post", schedule: "Jede Stunde, 9:17 – 20:17" },
    { title: "Parity check", schedule: "Jede Stunde, :17" },
  ],
  phone3: [
    { title: "Warmup sweep", schedule: "Idle — Start drücken" },
    { title: "Midday check", schedule: "Jeden Tag um 13:14" },
  ],
  phone4: [
    { title: "Warmup sweep", schedule: "Laufend" },
    { title: "Evening post wave", schedule: "Jeden Tag um 20:27" },
    { title: "Nightly learn", schedule: "Jeden Tag um 23:00" },
  ],
};

const HEALTH: Record<string, { state: string; swipes: number }> = {
  phone1: { state: "warmup", swipes: 3421 },
  phone2: { state: "posting", swipes: 2893 },
  phone3: { state: "idle", swipes: 452 },
  phone4: { state: "warmup", swipes: 1765 },
};

function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="shrink-0">
      <circle cx="10" cy="10" r="8.5" stroke="#30d158" strokeWidth="1.5" />
      <path d="M10 5.5V10L13 12" stroke="#30d158" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function OctagonChat() {
  const [sel, setSel] = useState("phone1");
  const [showPhone, setShowPhone] = useState(false);
  const croc = CROCS.find(c => c.id === sel) || CROCS[0];
  const msgs = MESSAGES[sel] || [];
  const routines = ROUTINES[sel] || [];
  const health = HEALTH[sel];

  return (
    <div className="h-screen flex flex-col bg-[#0d0d0f] text-[#f5f5f7] overflow-hidden select-none" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif" }}>
      {/* Titlebar */}
      <div className="h-[48px] shrink-0 flex items-center justify-between pl-4 pr-4">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-[8px]">
            <span className="w-[12px] h-[12px] rounded-full bg-[#ff5f57]" />
            <span className="w-[12px] h-[12px] rounded-full bg-[#febc2e]" />
            <span className="w-[12px] h-[12px] rounded-full bg-[#28c840]" />
          </div>
        </div>
        <div className="w-[264px] flex justify-end">
          <button className="w-[28px] h-[28px] rounded-lg hover:bg-[#1c1c1e] grid place-items-center text-[#98989d] text-xl leading-none">+</button>
        </div>
        <div className="flex items-center gap-4 text-[#98989d]">
          <button className="hover:text-[#f5f5f7]"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
          <button className="hover:text-[#f5f5f7] text-sm tracking-tighter">❯❯</button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-[275px] shrink-0 bg-[#111113] border-r border-[#1c1c1e] flex flex-col">
          <div className="px-3 pb-2">
            <div className="relative">
              <svg className="absolute left-2.5 top-[7px] text-[#636366]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
              <input placeholder="Suchen" className="w-full bg-[#1b1b1d] border border-[#2c2c2e] rounded-lg pl-8 pr-3 py-[6px] text-[13px] placeholder:text-[#636366] focus:outline-none focus:border-[#48484a]" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 space-y-[2px]">
            {CROCS.map(c => {
              const isSel = c.id === sel;
              return (
                <button key={c.id} onClick={() => setSel(c.id)} className={`w-full flex items-start gap-[10px] px-2 py-[9px] rounded-xl text-left transition-colors ${isSel ? "bg-[#2a2a2c]" : "hover:bg-[#1c1c1e]"}`}>
                  <span className="w-[36px] h-[36px] rounded-full grid place-items-center text-[17px] shrink-0" style={{ background: c.bg }}>{c.emoji}</span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-[6px]">
                      <span className="text-[13.5px] font-semibold text-[#f5f5f7] leading-tight">{c.name}</span>
                      {c.tag && <span className="text-[10.5px] px-[6px] py-[1px] rounded-md bg-[#2c2c2e] text-[#98989d]">{c.tag}</span>}
                      <span className="ml-auto text-[11px] text-[#636366]">{c.time}</span>
                    </span>
                    <span className="block text-[12.5px] text-[#98989d] truncate mt-[2px]">{c.preview}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="px-2 pb-3 pt-1 space-y-[2px]">
            <button className="w-full flex items-center gap-[10px] px-2 py-[8px] rounded-xl hover:bg-[#1c1c1e] text-left">
              <span className="w-[28px] h-[28px] rounded-full bg-[#2c2c2e] grid place-items-center text-[13px]">⊞</span>
              <span className="text-[13.5px] font-medium text-[#f5f5f7]">Plugins</span>
            </button>
            <button className="w-full flex items-center gap-[10px] px-2 py-[8px] rounded-xl hover:bg-[#1c1c1e] text-left">
              <span className="w-[28px] h-[28px] rounded-full bg-[#f59e0b] grid place-items-center text-[11px] font-bold text-black">YK</span>
              <span className="text-[13.5px] font-medium text-[#f5f5f7]">Yannis Kiefer</span>
            </button>
          </div>
        </aside>

        {/* Chat */}
        <main className="flex-1 min-w-0 flex flex-col bg-[#0d0d0f]">
          <div className="h-[52px] shrink-0 flex items-center gap-[10px] px-5">
            <span className="w-[34px] h-[34px] rounded-full grid place-items-center text-[16px]" style={{ background: croc.bg }}>{croc.emoji}</span>
            <div className="leading-tight">
              <div className="text-[14px] font-semibold">{croc.name}</div>
              <div className="text-[12px] text-[#636366]">863180542284</div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-4">
            {msgs.map((m, i) => (
              <div key={i} className="mb-4">
                <div className={`text-[11px] text-[#636366] mb-[6px] ${m.side === "right" ? "text-right pr-1" : "pl-1"}`}>{m.ts}</div>
                <div className={`max-w-[68%] rounded-[18px] px-[14px] py-[10px] text-[13.5px] leading-[1.5] whitespace-pre-wrap break-words ${m.side === "right" ? "ml-auto bg-[#323236]" : "bg-[#26262a]"}`}>
                  {m.text.split("\n").map((line, j) =>
                    /^https?:\/\//.test(line)
                      ? <span key={j} className="block"><a href={line} target="_blank" className="text-[#4aa3ff] hover:underline">{line}</a></span>
                      : <span key={j} className="block min-h-[4px]">{line}</span>
                  )}
                </div>
              </div>
            ))}
            <div className="flex justify-center py-3">
              <span className="text-[11.5px] text-[#636366] bg-[#1b1b1d] rounded-full px-[12px] py-[5px] inline-flex items-center gap-[6px]">
                Aktualisiert: Routinen <ClockIconSmall /> und <ClockIconSmall /> {routines[0]?.title ?? "Warmup"}
              </span>
            </div>
          </div>

          <div className="px-4 pb-4">
            <div className="flex items-center gap-3 bg-[#1b1b1d] border border-[#2c2c2e] rounded-full pl-2 pr-2 py-[7px]">
              <button className="w-[30px] h-[30px] rounded-full bg-[#2c2c2e] grid place-items-center text-[#98989d] hover:text-[#f5f5f7] text-lg leading-none">+</button>
              <input placeholder={`Nachricht an ${croc.name}`} className="flex-1 bg-transparent outline-none text-[13.5px] placeholder:text-[#636366]" />
              <button className="w-[30px] h-[30px] rounded-full bg-[#f5f5f7] grid place-items-center text-black">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3z"/><path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20h-2a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.08A7 7 0 0 0 19 11z"/></svg>
              </button>
            </div>
          </div>
        </main>

        {/* Right panel */}
        <aside className="w-[370px] shrink-0 bg-[#111113] border-l border-[#1c1c1e] hidden lg:flex flex-col">
          <div className="h-[52px] shrink-0" />
          <div className="px-5 overflow-y-auto">
            <div className="text-[12.5px] text-[#98989d] text-center mb-2">Bildschirm von {croc.name}</div>
            <button onClick={() => setShowPhone(true)} className="w-full aspect-[4/3] bg-[#1a1a1c] border border-[#2c2c2e] rounded-xl grid place-items-center hover:border-[#48484a] transition-colors">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 rounded-full border-[2.5px] border-[#3a3a3c] border-t-[#98989d] animate-spin" />
                <div className="text-[11px] text-[#636366]">{croc.name} · {health.state}</div>
              </div>
            </button>

            <div className="flex items-center justify-between mt-6 mb-2">
              <span className="text-[15px] font-semibold">Routinen</span>
              <button className="w-[26px] h-[26px] rounded-lg hover:bg-[#1c1c1e] grid place-items-center text-[#98989d] text-lg leading-none">+</button>
            </div>
            <div className="space-y-[6px] pb-6">
              {routines.map(r => (
                <div key={r.title} className="flex items-center gap-[10px] px-2 py-[7px] rounded-lg hover:bg-[#1c1c1e]">
                  <ClockIcon />
                  <div className="leading-tight">
                    <div className="text-[13.5px] font-medium">{r.title}</div>
                    <div className="text-[12px] text-[#98989d]">{r.schedule}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* Phone modal — click the screen, see what the agent sees */}
      {showPhone && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-[2px] z-50 grid place-items-center" onClick={() => setShowPhone(false)}>
          <div className="w-[340px] bg-[#111113] border border-[#2c2c2e] rounded-[28px] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="h-[44px] flex items-center justify-between px-4 border-b border-[#1c1c1e]">
              <span className="text-[13px] font-semibold">{croc.name} — was es gerade sieht</span>
              <button onClick={() => setShowPhone(false)} className="w-[24px] h-[24px] rounded-full bg-[#2c2c2e] grid place-items-center text-[#98989d] text-[11px]">✕</button>
            </div>
            <div className="p-4">
              <div className="aspect-[9/18] bg-[#0a0a0b] rounded-[20px] border-[3px] border-[#2c2c2e] grid place-items-center">
                <div className="flex flex-col items-center gap-3 px-6 text-center">
                  <div className="w-9 h-9 rounded-full border-[2.5px] border-[#3a3a3c] border-t-[#98989d] animate-spin" />
                  <div className="text-[13px] font-medium">{croc.name} live view</div>
                  <div className="text-[11.5px] text-[#98989d]">{health.state} · {health.swipes.toLocaleString("de-DE")} Swipes</div>
                  <div className="text-[11px] text-[#30d158]">Voller Kontext — Screen, Health, Events. Frag alles.</div>
                </div>
              </div>
            </div>
            <div className="px-4 pb-4 flex gap-2">
              <button onClick={() => setShowPhone(false)} className="flex-1 bg-[#2c2c2e] hover:bg-[#3a3a3c] rounded-full py-[9px] text-[13.5px] font-semibold transition-colors">Schließen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ClockIconSmall() {
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" className="inline">
      <circle cx="10" cy="10" r="8.5" stroke="#636366" strokeWidth="2" />
      <path d="M10 5.5V10L13 12" stroke="#636366" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
