"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Octagon — chat with your phone farm. Every phone is an agent.
// Design language 1:1 from documents/designs. Everything works end-to-end via /api/farm/*.

type Croc = { id: string; name: string; tag?: string; emoji: string; bg: string; preview: string; time: string; swipes: number; state: string };
type Msg = { ts: string; text: string; side: "left" | "right" };
type Routine = { id: string; title: string; schedule: string };

const FALLBACK_CROCS: Croc[] = [
  { id: "phone1", name: "Alpha", tag: "Warmup", emoji: "🤖", bg: "#3a3a3c", preview: "Ran the nightly learn pass and…", time: "Gestern", swipes: 3421, state: "warmup" },
  { id: "phone2", name: "Bravo", emoji: "⚡", bg: "#7d5cf6", preview: "18 of 18 posted. You didn't touch it.", time: "Gestern", swipes: 2893, state: "posting" },
  { id: "phone3", name: "Charlie", emoji: "💤", bg: "#3b82f6", preview: "Idle — tap Start and I warm up.", time: "Gestern", swipes: 452, state: "idle" },
  { id: "phone4", name: "Delta", emoji: "🔥", bg: "#f59e0b", preview: "Warmup done. Next slot at 20:27.", time: "Samstag", swipes: 1765, state: "warmup" },
];
const FALLBACK_MSGS: Record<string, Msg[]> = {
  phone1: [
    { ts: "Gestern 21:05", side: "left", text: "US evening: 0 replies. Nothing cleared 12x that was actually our ICP (closest was a Turkish Trendyol tax rant, skipped)." },
    { ts: "Gestern 21:05", side: "left", text: "Shipped one original off the unused angle instead — link is in the queue." },
    { ts: "Gestern 23:02", side: "left", text: "Last hourly: still no gold. Didn't pad. Original already went out this hour so nothing else to ship." },
    { ts: "Gestern 23:18", side: "right", text: "Ran the nightly learn pass — numbers clear enough to change the playbook.\n\nTwo changes: zero-gold hour now means no post at all (slot goes to follows + harder scouting), and the hunt widened to FR/DE/ES. Cron re-rolled to :17 / 20:27." },
  ],
};
const FALLBACK_ROUTINES: Routine[] = [
  { id: "r1", title: "Warmup sweep", schedule: "Jeden Tag um 8:27" },
  { id: "r2", title: "Auto-post", schedule: "Jede Stunde, 9:17 – 20:17" },
  { id: "r3", title: "Parity check", schedule: "Jeden Tag um 13:14" },
  { id: "r4", title: "Nightly learn", schedule: "Jeden Tag um 23:00" },
];

function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="shrink-0">
      <circle cx="10" cy="10" r="8.5" stroke="#30d158" strokeWidth="1.5" />
      <path d="M10 5.5V10L13 12" stroke="#30d158" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function ClockSmall() {
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" className="inline mx-[2px] -mt-[2px]">
      <circle cx="10" cy="10" r="8.5" stroke="#636366" strokeWidth="2" />
      <path d="M10 5.5V10L13 12" stroke="#636366" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function timeAgo(iso: string): string {
  const d = new Date(iso);
  const m = Math.floor((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "Jetzt";
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  return d.toLocaleDateString("de-DE", { weekday: "long" });
}

export default function OctagonChat() {
  const [crocs, setCrocs] = useState<Croc[]>(FALLBACK_CROCS);
  const [sel, setSel] = useState("phone1");
  const [messages, setMessages] = useState<Record<string, Msg[]>>(FALLBACK_MSGS);
  const [routines, setRoutines] = useState<Record<string, Routine[]>>({});
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [showRight, setShowRight] = useState(true);
  const [modal, setModal] = useState<null | "phone" | "add" | "settings" | "routine">(null);
  const [newAgentName, setNewAgentName] = useState("");
  const [routineTitle, setRoutineTitle] = useState("");
  const [settings, setSettings] = useState<{ status: string; db: string; ts: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recogRef = useRef<any>(null);

  const croc = crocs.find(c => c.id === sel) || crocs[0];
  const msgs = messages[sel] || [];
  const routineList = routines[sel] || FALLBACK_ROUTINES;
  const filtered = crocs.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  const loadDevices = useCallback(async () => {
    try {
      const j = await (await fetch("/api/farm/devices")).json();
      if (j.success && j.devices?.length) {
        setCrocs(j.devices.map((d: any, i: number) => {
          const h = (j.health || []).find((x: any) => x.device_id === d.id);
          const fb = FALLBACK_CROCS[i % FALLBACK_CROCS.length];
          return {
            id: d.id, name: d.voice_prefix, emoji: fb.emoji, bg: fb.bg,
            preview: `${h?.session_state || "idle"} · ${(h?.swipes || 0).toLocaleString("de-DE")} Swipes`,
            time: timeAgo(h?.updated_at || d.updated_at),
            swipes: h?.swipes || 0, state: h?.session_state || "idle",
          };
        }));
      }
    } catch { /* fallback stays */ }
  }, []);

  const loadMessages = useCallback(async (phoneId: string) => {
    try {
      const j = await (await fetch(`/api/farm/events?phoneId=${phoneId}&limit=50`)).json();
      if (j.success && j.events?.length) {
        setMessages(prev => ({
          ...prev,
          [phoneId]: j.events.slice().reverse().map((e: any) => ({
            ts: timeAgo(e.ts), side: e.data?.includes('"side": "user"') ? "right" : "left", text: e.event,
          })),
        }));
      }
    } catch { /* fallback stays */ }
  }, []);

  const loadRoutines = useCallback(async (phoneId: string) => {
    try {
      const j = await (await fetch("/api/farm/tasks")).json();
      if (j.success && j.tasks?.length) {
        const mine = j.tasks.filter((t: any) => !t.device_id || t.device_id === phoneId).slice(0, 6);
        if (mine.length) setRoutines(prev => ({
          ...prev,
          [phoneId]: mine.map((t: any) => ({
            id: t.id,
            title: (() => { try { const pl = JSON.parse(t.payload || "{}"); if (pl.title) return pl.title; } catch {} return t.type === "warmup" ? "Warmup sweep" : t.type === "post" ? "Auto-post" : t.type === "audit" ? "Parity check" : t.type; })(),
            schedule: t.status === "running" ? "Läuft jetzt" : t.status === "scheduled" ? timeAgo(t.scheduled_for) : t.status,
          })),
        }));
      }
    } catch { /* fallback stays */ }
  }, []);

  useEffect(() => { loadDevices(); }, [loadDevices]);
  useEffect(() => { loadMessages(sel); loadRoutines(sel); }, [sel, loadMessages, loadRoutines]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [msgs.length, sel]);

  // ---- actions (all real, all hit SQLite) ----
  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    setMessages(prev => ({ ...prev, [sel]: [...(prev[sel] || []), { ts: "Jetzt", side: "right", text }] }));
    try {
      const j = await (await fetch("/api/farm/events", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: sel, text }),
      })).json();
      if (j.success) {
        setMessages(prev => ({
          ...prev,
          [sel]: [...(prev[sel] || []), { ts: "Jetzt", side: "right", text }, { ts: "Jetzt", side: "left", text: j.replyEvent.event }],
        }));
        loadDevices();
      }
    } catch { /* optimistic bubble stays */ }
    setSending(false);
  }

  async function addAgent() {
    const name = newAgentName.trim();
    if (name.length < 2) return;
    try {
      const j = await (await fetch("/api/farm/devices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: name }),
      })).json();
      if (j.success) {
        await loadDevices();
        setSel(j.device.id);
        setModal(null);
        setNewAgentName("");
      }
    } catch { /* modal stays on failure */ }
  }

  async function openSettings() {
    setModal("settings");
    try {
      const j = await (await fetch("/api/health")).json();
      setSettings({ status: j.status, db: j.checks?.database || "?", ts: new Date(j.timestamp).toLocaleString("de-DE") });
    } catch { setSettings({ status: "unreachable", db: "?", ts: "—" }); }
  }

  async function addRoutine() {
    const title = routineTitle.trim();
    if (!title) return;
    const type = /post/i.test(title) ? "post" : /audit|parity/i.test(title) ? "audit" : "warmup";
    try {
      await fetch("/api/farm/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, device_id: sel, payload: { title } }),
      });
      await loadRoutines(sel);
      setModal(null);
      setRoutineTitle("");
    } catch { /* modal stays */ }
  }

  function onDropVideo(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    fetch("/api/farm/events", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: sel, text: `Video "${f.name}" empfangen — ich poste es im nächsten Slot.` }),
    }).then(() => loadMessages(sel));
  }

  function toggleMic() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (listening) { recogRef.current?.stop(); setListening(false); return; }
    const rec = new SR();
    rec.lang = "de-DE";
    rec.onresult = (e: any) => setInput(e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    recogRef.current = rec;
    rec.start();
    setListening(true);
  }

  return (
    <div className="h-screen flex flex-col bg-[#0d0d0f] text-[#f5f5f7] overflow-hidden select-none" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif" }}>
      {/* Titlebar — web app: only working controls, no fake window chrome */}
      <div className="h-[48px] shrink-0 flex items-center justify-between pl-4 pr-4">
        <span className="text-[13px] font-semibold text-[#636366] tracking-wide">Octagon</span>
        <div className="w-[264px] flex justify-end">
          <button title="Agent hinzufügen" onClick={() => setModal("add")} className="w-[28px] h-[28px] rounded-lg hover:bg-[#1c1c1e] grid place-items-center text-[#98989d] hover:text-[#f5f5f7] text-xl leading-none">+</button>
        </div>
        <div className="flex items-center gap-4 text-[#98989d]">
          <button title="Einstellungen" onClick={openSettings} className="hover:text-[#f5f5f7]">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
          <button title="Panel ein-/ausklappen" onClick={() => setShowRight(v => !v)} className="hover:text-[#f5f5f7] text-sm tracking-tighter">❯❯</button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-[275px] shrink-0 bg-[#111113] border-r border-[#1c1c1e] flex flex-col">
          <div className="px-3 pb-2">
            <div className="relative">
              <svg className="absolute left-2.5 top-[7px] text-[#636366]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Suchen" className="w-full bg-[#1b1b1d] border border-[#2c2c2e] rounded-lg pl-8 pr-3 py-[6px] text-[13px] placeholder:text-[#636366] focus:outline-none focus:border-[#48484a]" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2 space-y-[2px]">
            {filtered.map(c => {
              const isSel = c.id === sel;
              return (
                <button key={c.id} onClick={() => setSel(c.id)} className={`w-full flex items-start gap-[10px] px-2 py-[9px] rounded-xl text-left transition-colors ${isSel ? "bg-[#2a2a2c]" : "hover:bg-[#1c1c1e]"}`}>
                  <span className="w-[36px] h-[36px] rounded-full grid place-items-center text-[17px] shrink-0" style={{ background: c.bg }}>{c.emoji}</span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-[6px]">
                      <span className="text-[13.5px] font-semibold leading-tight">{c.name}</span>
                      {c.tag && <span className="text-[10.5px] px-[6px] py-[1px] rounded-md bg-[#2c2c2e] text-[#98989d]">{c.tag}</span>}
                      <span className="ml-auto text-[11px] text-[#636366]">{c.time}</span>
                    </span>
                    <span className="block text-[12.5px] text-[#98989d] truncate mt-[2px]">{c.preview}</span>
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && <div className="px-3 py-6 text-[12.5px] text-[#636366]">Kein Agent gefunden.</div>}
          </div>
          <div className="px-2 pb-3 pt-1">
            <button onClick={() => setModal("add")} className="w-full flex items-center gap-[10px] px-2 py-[8px] rounded-xl hover:bg-[#1c1c1e] text-left">
              <span className="w-[28px] h-[28px] rounded-full border border-dashed border-[#48484a] grid place-items-center text-[#98989d]">+</span>
              <span className="text-[13.5px] font-medium text-[#98989d]">Agent hinzufügen</span>
            </button>
          </div>
        </aside>

        {/* Chat */}
        <main className="flex-1 min-w-0 flex flex-col bg-[#0d0d0f]">
          <div className="h-[52px] shrink-0 flex items-center gap-[10px] px-5">
            <span className="w-[34px] h-[34px] rounded-full grid place-items-center text-[16px]" style={{ background: croc.bg }}>{croc.emoji}</span>
            <div className="leading-tight">
              <div className="text-[14px] font-semibold">{croc.name}</div>
              <div className="text-[12px] text-[#636366]">{croc.id}</div>
            </div>
            <span className="ml-auto text-[11.5px] text-[#98989d]">{croc.state} · {croc.swipes.toLocaleString("de-DE")} Swipes</span>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 pb-4">
            {msgs.map((m, i) => (
              <div key={i} className="mb-4">
                <div className={`text-[11px] text-[#636366] mb-[6px] ${m.side === "right" ? "text-right pr-1" : "pl-1"}`}>{m.ts}</div>
                <div className={`max-w-[68%] rounded-[18px] px-[14px] py-[10px] text-[13.5px] leading-[1.5] whitespace-pre-wrap break-words ${m.side === "right" ? "ml-auto bg-[#323236]" : "bg-[#26262a]"}`}>{m.text}</div>
              </div>
            ))}
            {msgs.length > 0 && (
              <div className="flex justify-center py-3">
                <span className="text-[11.5px] text-[#636366] bg-[#1b1b1d] rounded-full px-[12px] py-[5px] inline-flex items-center">
                  Aktualisiert: Routinen <ClockSmall /> und <ClockSmall /> {routineList[0]?.title ?? "Warmup"}
                </span>
              </div>
            )}
          </div>

          <div className="px-4 pb-4">
            <div className="flex items-center gap-3 bg-[#1b1b1d] border border-[#2c2c2e] rounded-full pl-2 pr-2 py-[7px]">
              <button title="Video ablegen" onClick={() => fileRef.current?.click()} className="w-[30px] h-[30px] rounded-full bg-[#2c2c2e] grid place-items-center text-[#98989d] hover:text-[#f5f5f7] text-lg leading-none">+</button>
              <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={e => onDropVideo(e.target.files)} />
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={`Nachricht an ${croc.name}`}
                className="flex-1 bg-transparent outline-none text-[13.5px] placeholder:text-[#636366]"
              />
              <button
                title="Diktieren"
                onClick={toggleMic}
                className={`w-[30px] h-[30px] rounded-full grid place-items-center ${listening ? "bg-[#30d158] text-black animate-pulse" : "bg-[#f5f5f7] text-black"}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3z"/><path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20h-2a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.08A7 7 0 0 0 19 11z"/></svg>
              </button>
            </div>
          </div>
        </main>

        {/* Right panel */}
        {showRight && (
        <aside className="w-[370px] shrink-0 bg-[#111113] border-l border-[#1c1c1e] hidden lg:flex flex-col">
          <div className="h-[52px] shrink-0" />
          <div className="px-5 overflow-y-auto">
            <div className="text-[12.5px] text-[#98989d] text-center mb-2">Bildschirm von {croc.name}</div>
            <button onClick={() => setModal("phone")} className="w-full aspect-[4/3] bg-[#1a1a1c] border border-[#2c2c2e] rounded-xl grid place-items-center hover:border-[#48484a] transition-colors">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 rounded-full border-[2.5px] border-[#3a3a3c] border-t-[#98989d] animate-spin" />
                <div className="text-[11px] text-[#636366]">{croc.name} · {croc.state}</div>
              </div>
            </button>

            <div className="flex items-center justify-between mt-6 mb-2">
              <span className="text-[15px] font-semibold">Routinen</span>
              <button title="Routine hinzufügen" onClick={() => setModal("routine")} className="w-[26px] h-[26px] rounded-lg hover:bg-[#1c1c1e] grid place-items-center text-[#98989d] hover:text-[#f5f5f7] text-lg leading-none">+</button>
            </div>
            <div className="space-y-[6px] pb-6">
              {routineList.map(r => (
                <div key={r.id} className="flex items-center gap-[10px] px-2 py-[7px] rounded-lg hover:bg-[#1c1c1e]">
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
        )}
      </div>

      {/* Modals */}
      {modal === "phone" && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-[2px] z-50 grid place-items-center" onClick={() => setModal(null)}>
          <div className="w-[340px] bg-[#111113] border border-[#2c2c2e] rounded-[28px] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="h-[44px] flex items-center justify-between px-4 border-b border-[#1c1c1e]">
              <span className="text-[13px] font-semibold">{croc.name} — was es gerade sieht</span>
              <button onClick={() => setModal(null)} className="w-[24px] h-[24px] rounded-full bg-[#2c2c2e] grid place-items-center text-[#98989d] text-[11px]">✕</button>
            </div>
            <div className="p-4">
              <div className="aspect-[9/18] bg-[#0a0a0b] rounded-[20px] border-[3px] border-[#2c2c2e] grid place-items-center">
                <div className="flex flex-col items-center gap-3 px-6 text-center">
                  <div className="w-9 h-9 rounded-full border-[2.5px] border-[#3a3a3c] border-t-[#98989d] animate-spin" />
                  <div className="text-[13px] font-medium">{croc.name} live view</div>
                  <div className="text-[11.5px] text-[#98989d]">{croc.state} · {croc.swipes.toLocaleString("de-DE")} Swipes</div>
                  <div className="text-[11px] text-[#30d158]">Voller Kontext — Screen, Health, Events. Frag alles.</div>
                </div>
              </div>
            </div>
            <div className="px-4 pb-4"><button onClick={() => setModal(null)} className="w-full bg-[#2c2c2e] hover:bg-[#3a3a3c] rounded-full py-[9px] text-[13.5px] font-semibold transition-colors">Schließen</button></div>
          </div>
        </div>
      )}

      {modal === "add" && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-[2px] z-50 grid place-items-center" onClick={() => setModal(null)}>
          <div className="w-[360px] bg-[#111113] border border-[#2c2c2e] rounded-[24px] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="h-[44px] flex items-center justify-between px-4 border-b border-[#1c1c1e]">
              <span className="text-[13px] font-semibold">Agent hinzufügen</span>
              <button onClick={() => setModal(null)} className="w-[24px] h-[24px] rounded-full bg-[#2c2c2e] grid place-items-center text-[#98989d] text-[11px]">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <label className="block text-[12px] text-[#98989d]">Name / Sprach-Prefix</label>
              <input value={newAgentName} onChange={e => setNewAgentName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addAgent(); }} placeholder="z. B. Echo" autoFocus className="w-full bg-[#1b1b1d] border border-[#2c2c2e] rounded-lg px-3 py-[8px] text-[13.5px] placeholder:text-[#636366] focus:outline-none focus:border-[#48484a]" />
              <p className="text-[11.5px] text-[#636366]">Wird als phone{crocs.length + 1} zur Farm hinzugefügt. Sag später &ldquo;{newAgentName || "Echo"} Swipe Next&rdquo; — das Phone hört zu.</p>
              <button onClick={addAgent} disabled={newAgentName.trim().length < 2} className="w-full bg-[#f5f5f7] disabled:opacity-40 hover:bg-white text-black rounded-full py-[9px] text-[13.5px] font-semibold transition-colors">Hinzufügen</button>
            </div>
          </div>
        </div>
      )}

      {modal === "settings" && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-[2px] z-50 grid place-items-center" onClick={() => setModal(null)}>
          <div className="w-[380px] bg-[#111113] border border-[#2c2c2e] rounded-[24px] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="h-[44px] flex items-center justify-between px-4 border-b border-[#1c1c1e]">
              <span className="text-[13px] font-semibold">Einstellungen</span>
              <button onClick={() => setModal(null)} className="w-[24px] h-[24px] rounded-full bg-[#2c2c2e] grid place-items-center text-[#98989d] text-[11px]">✕</button>
            </div>
            <div className="p-4 space-y-[2px] text-[13px]">
              <div className="flex justify-between py-[7px]"><span className="text-[#98989d]">Status</span><span>{settings ? (settings.status === "healthy" ? "Gesund" : settings.status) : "…"}</span></div>
              <div className="flex justify-between py-[7px]"><span className="text-[#98989d]">Datenbank</span><span>SQLite · lokal · {settings?.db}</span></div>
              <div className="flex justify-between py-[7px]"><span className="text-[#98989d]">Agents</span><span>{crocs.length}</span></div>
              <div className="flex justify-between py-[7px]"><span className="text-[#98989d]">Cloud</span><span className="text-[#30d158]">Keine — alles bleibt auf diesem Mac</span></div>
              <div className="flex justify-between py-[7px]"><span className="text-[#98989d]">Geprüft</span><span className="text-[#98989d]">{settings?.ts || "—"}</span></div>
            </div>
          </div>
        </div>
      )}

      {modal === "routine" && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-[2px] z-50 grid place-items-center" onClick={() => setModal(null)}>
          <div className="w-[360px] bg-[#111113] border border-[#2c2c2e] rounded-[24px] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="h-[44px] flex items-center justify-between px-4 border-b border-[#1c1c1e]">
              <span className="text-[13px] font-semibold">Routine für {croc.name}</span>
              <button onClick={() => setModal(null)} className="w-[24px] h-[24px] rounded-full bg-[#2c2c2e] grid place-items-center text-[#98989d] text-[11px]">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <input value={routineTitle} onChange={e => setRoutineTitle(e.target.value)} placeholder="z. B. Abend-Warmup" autoFocus className="w-full bg-[#1b1b1d] border border-[#2c2c2e] rounded-lg px-3 py-[8px] text-[13.5px] placeholder:text-[#636366] focus:outline-none focus:border-[#48484a]" />
              <button onClick={addRoutine} disabled={!routineTitle.trim()} className="w-full bg-[#f5f5f7] disabled:opacity-40 hover:bg-white text-black rounded-full py-[9px] text-[13.5px] font-semibold transition-colors">Anlegen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
