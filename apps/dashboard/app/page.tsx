"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

// Octagon - local-first console for an iPhone fleet.
// Everything shown here comes from /api/farm/* and the local SQLite file.
// No demo data, no simulated screens: if the farm has nothing, this says so.

type Device = {
  id: string;
  voice_prefix: string;
  display_name?: string;
  usb_udid?: string;
  updated_at?: string;
};

type Health = {
  device_id: string;
  usb_connected: number;
  session_state: string;
  swipes: number;
  last_action: string;
  last_action_at: string | null;
  jitter_variance: number;
  error: string;
  updated_at: string;
};

type Task = {
  id: string;
  type: string;
  device_id: string | null;
  scheduled_for: string;
  status: "scheduled" | "running" | "succeeded" | "failed" | "canceled";
  payload: string;
  error: string;
  updated_at: string;
};

type EventRow = {
  id: string;
  ts: string;
  level: string;
  device_id: string;
  event: string;
  data: string;
};

type HubRow = { active: number; locked: number; ts: string };

type ChatMsg = { ts: string; text: string; side: "left" | "right"; level: string };

type SettingsData = {
  status: string;
  database: string;
  timestamp: string;
  reachable: boolean;
};

const AVATAR_BGS = ["#3a3a3c", "#7d5cf6", "#3b82f6", "#f59e0b"];
const SESSION_PRESETS = [5, 10, 15, 30, 60];

function avatarBg(id: string): string {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return AVATAR_BGS[sum % AVATAR_BGS.length];
}

// Relative for anything younger than 24h ("4m ago"), clock-and-date after that.
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 24 * 60) return `${Math.floor(diffMin / 60)}h ago`;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "invalid" : d.toDateString();
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function parseDuration(payload: string): number | null {
  try {
    const p = JSON.parse(payload || "{}");
    const n = Number(p.duration_minutes);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

const STATUS_CHIP: Record<Task["status"], string> = {
  scheduled: "bg-[#2c2c2e] text-[#98989d]",
  running: "bg-[rgba(48,209,88,0.15)] text-[#30d158]",
  succeeded: "bg-[rgba(48,209,88,0.15)] text-[#30d158]",
  failed: "bg-[rgba(255,69,58,0.15)] text-[#ff453a]",
  canceled: "bg-[#2c2c2e] text-[#636366]",
};

function OctagonMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <polygon
        points="25.2,19.8 19.8,25.2 12.2,25.2 6.8,19.8 6.8,12.2 12.2,6.8 19.8,6.8 25.2,12.2"
        fill="none"
        stroke="#98989d"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="2.6" fill="#30d158" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#636366]">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3z" />
      <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20h-2a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.08A7 7 0 0 0 19 11z" />
    </svg>
  );
}

function Modal({
  title,
  onClose,
  children,
  maxWidth = 380,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full bg-[#111113] border border-[#2c2c2e] rounded-[24px] shadow-2xl overflow-hidden"
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-11 flex items-center justify-between px-4 border-b border-[#1c1c1e]">
          <span className="text-[13px] font-semibold">{title}</span>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="w-6 h-6 rounded-full bg-[#2c2c2e] grid place-items-center text-[#98989d] hover:text-[#f5f5f7] text-[11px] leading-none"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DetailRow({ label, value, valueClass = "" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-[7px] text-[13px]">
      <span className="text-[#98989d] shrink-0">{label}</span>
      <span className={`text-right break-words min-w-0 ${valueClass}`}>{value}</span>
    </div>
  );
}

export default function OctagonChat() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [health, setHealth] = useState<Health[]>([]);
  const [hub, setHub] = useState<HubRow | null>(null);
  const [farmLoaded, setFarmLoaded] = useState(false);
  const [farmError, setFarmError] = useState<null | "auth" | "error">(null);
  const [farmErrorMsg, setFarmErrorMsg] = useState("");

  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksError, setTasksError] = useState(false);

  const [messages, setMessages] = useState<Record<string, ChatMsg[]>>({});
  const [msgError, setMsgError] = useState(false);

  const [sel, setSel] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [modal, setModal] = useState<null | "details" | "add" | "settings" | "session">(null);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [addPrefix, setAddPrefix] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);
  const [sessionMinutes, setSessionMinutes] = useState<string>("");
  const [sessionError, setSessionError] = useState("");
  const [sessionPosting, setSessionPosting] = useState(false);

  const [micOk, setMicOk] = useState(false);
  const [listening, setListening] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const recogRef = useRef<any>(null);
  const selRef = useRef<string | null>(null);
  selRef.current = sel;

  const device = devices.find((d) => d.id === sel) ?? devices[0] ?? null;
  const h = device ? health.find((x) => x.device_id === device.id) ?? null : null;
  const msgs = device ? messages[device.id] ?? [] : [];
  const deviceTasks = device
    ? tasks
        .filter((t) => t.device_id === device.id)
        .slice()
        .sort((a, b) => (a.scheduled_for < b.scheduled_for ? 1 : -1))
        .slice(0, 8)
    : [];
  const filtered = devices.filter(
    (d) =>
      d.voice_prefix.toLowerCase().includes(search.toLowerCase()) ||
      d.id.toLowerCase().includes(search.toLowerCase()),
  );
  const hubRunning = Boolean(
    hub && hub.active > 0 && Date.now() - new Date(hub.ts).getTime() < 20000,
  );

  const loadFarm = useCallback(async () => {
    try {
      const res = await fetch("/api/farm", { cache: "no-store" });
      const j = await res.json().catch(() => null);
      if (res.status === 401 || res.redirected) {
        setFarmError("auth");
      } else if (!j?.success) {
        setFarmError("error");
        setFarmErrorMsg(String(j?.error || `HTTP ${res.status}`));
      } else {
        setFarmError(null);
        setDevices(Array.isArray(j.devices) ? j.devices : []);
        setHealth(Array.isArray(j.health) ? j.health : []);
        setHub(j.hubStatus ?? null);
      }
    } catch {
      setFarmError("error");
      setFarmErrorMsg("The farm API is unreachable.");
    }
    setFarmLoaded(true);
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/farm/tasks", { cache: "no-store" });
      const j = await res.json().catch(() => null);
      if (res.redirected) {
        setTasksError(true);
      } else if (res.ok && j?.success) {
        setTasks(Array.isArray(j.tasks) ? j.tasks : []);
        setTasksError(false);
      } else {
        setTasksError(true);
      }
    } catch {
      setTasksError(true);
    }
  }, []);

  const loadEvents = useCallback(async (deviceId: string) => {
    try {
      const res = await fetch(
        `/api/farm/events?phoneId=${encodeURIComponent(deviceId)}&limit=50`,
        { cache: "no-store" },
      );
      const j = await res.json().catch(() => null);
      if (res.status === 401 || res.redirected) {
        setMsgError(true);
      } else if (res.ok && j?.success) {
        const rows: EventRow[] = Array.isArray(j.events) ? j.events : [];
        setMessages((prev) => ({
          ...prev,
          [deviceId]: rows
            .slice()
            .reverse()
            .map((e) => ({
              ts: e.ts,
              text: String(e.event ?? ""),
              // data is JSON.stringify({side:"user"}) - compact, so ignore whitespace.
              side: String(e.data ?? "")
                .replace(/\s/g, "")
                .includes('"side":"user"')
                ? "right"
                : "left",
              level: String(e.level ?? "info"),
            })),
        }));
        setMsgError(false);
      } else {
        setMsgError(true);
      }
    } catch {
      setMsgError(true);
    }
  }, []);

  useEffect(() => {
    loadFarm();
    loadTasks();
  }, [loadFarm, loadTasks]);

  useEffect(() => {
    if (device && device.id !== sel) setSel(device.id);
  }, [device, sel]);

  useEffect(() => {
    if (sel) loadEvents(sel);
  }, [sel, loadEvents]);

  useEffect(() => {
    const t = setInterval(() => {
      loadFarm();
      loadTasks();
      if (selRef.current) loadEvents(selRef.current);
    }, 10000);
    return () => clearInterval(t);
  }, [loadFarm, loadTasks, loadEvents]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs.length, sel]);

  useEffect(() => {
    setMicOk(Boolean(
      typeof window !== "undefined" &&
        ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition),
    ));
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  async function send() {
    const text = input.trim();
    if (!text || sending || !device) return;
    setInput("");
    setSendError("");
    setSending(true);
    try {
      const res = await fetch("/api/farm/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: device.id, text }),
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.success) {
        await loadEvents(device.id);
        loadFarm();
        loadTasks();
      } else if (res.status === 401 || res.redirected) {
        setSendError("Sign in required to send messages.");
      } else {
        setSendError(`Could not send: ${j?.error || `HTTP ${res.status}`}`);
      }
    } catch {
      setSendError("Could not send. The farm API is unreachable.");
    }
    setSending(false);
  }

  function toggleMic() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (listening) {
      recogRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      const t = e.results?.[0]?.[0]?.transcript;
      if (t) setInput((prev: string) => (prev ? `${prev} ${t}` : t));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recogRef.current = rec;
    rec.start();
    setListening(true);
  }

  async function addDevice() {
    const p = addPrefix.trim();
    if (p.length < 2 || p.length > 20) {
      setAddError("Prefix must be 2 to 20 characters.");
      return;
    }
    setAddError("");
    setAdding(true);
    try {
      const res = await fetch("/api/farm/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: p }),
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.success) {
        await loadFarm();
        setSel(j.device?.id ?? null);
        setModal(null);
        setAddPrefix("");
      } else if (res.status === 401 || res.redirected) {
        setAddError("Sign in required to add devices.");
      } else {
        setAddError(String(j?.error || `Could not add the device (HTTP ${res.status}).`));
      }
    } catch {
      setAddError("Could not add the device. The farm API is unreachable.");
    }
    setAdding(false);
  }

  async function scheduleSession() {
    if (!device) return;
    const n = Number(sessionMinutes);
    if (!Number.isInteger(n) || n < 1 || n > 180) {
      setSessionError("Enter a whole number of minutes between 1 and 180.");
      return;
    }
    setSessionError("");
    setSessionPosting(true);
    try {
      const res = await fetch("/api/farm/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "session",
          device_id: device.id,
          payload: { duration_minutes: n },
        }),
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.success) {
        setModal(null);
        setSessionMinutes("");
        loadTasks();
      } else if (res.status === 401 || res.redirected) {
        setSessionError("Sign in required to schedule sessions.");
      } else if (res.status === 403) {
        setSessionError("Scheduling sessions requires the admin role.");
      } else {
        setSessionError(String(j?.error || `Could not schedule the session (HTTP ${res.status}).`));
      }
    } catch {
      setSessionError("Could not schedule the session. The farm API is unreachable.");
    }
    setSessionPosting(false);
  }

  async function openSettings() {
    setModal("settings");
    setSettings(null);
    setSettingsLoading(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const j = await res.json().catch(() => null);
      if (j?.status) {
        setSettings({
          status: String(j.status),
          database: String(j.checks?.database ?? "unknown"),
          timestamp: String(j.timestamp ?? ""),
          reachable: true,
        });
      } else {
        setSettings({ status: "unreachable", database: "unknown", timestamp: "", reachable: false });
      }
    } catch {
      setSettings({ status: "unreachable", database: "unknown", timestamp: "", reachable: false });
    }
    setSettingsLoading(false);
  }

  function closeAndResetAdd() {
    setModal(null);
    setAddError("");
  }

  // ---- shared sidebar content (desktop column and mobile drawer) ----
  function sidebarContent() {
    return (
      <>
        <div className="px-3 pb-2">
          <div className="relative">
            <SearchIcon />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              aria-label="Search devices"
              className="w-full bg-[#1b1b1d] border border-[#2c2c2e] rounded-lg pl-8 pr-3 py-[6px] text-[13px] placeholder:text-[#636366] focus:outline-none focus:border-[#48484a]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-[2px]">
          {farmError === "auth" && (
            <div className="px-3 py-4 text-[12.5px] text-[#98989d] leading-relaxed">
              Sign in required.
              <br />
              <Link href="/login" className="text-[#f5f5f7] underline underline-offset-2">
                Go to login
              </Link>
            </div>
          )}
          {farmError === "error" && (
            <div className="px-3 py-4 text-[12.5px] text-[#98989d] leading-relaxed">
              Could not load devices.
              <br />
              <span className="text-[#636366] break-words">{farmErrorMsg}</span>
            </div>
          )}
          {farmLoaded && !farmError && devices.length === 0 && (
            <div className="px-3 py-4 text-[12.5px] text-[#98989d] leading-relaxed">
              <p>No devices yet. Add one, or run:</p>
              <code className="block mt-2 bg-[#1b1b1d] border border-[#2c2c2e] rounded-lg px-2 py-[6px] text-[11.5px] text-[#f5f5f7] break-all">
                node scripts/seed-demo.js
              </code>
            </div>
          )}
          {filtered.map((d) => {
            const dh = health.find((x) => x.device_id === d.id) ?? null;
            const isSel = d.id === device?.id;
            const state = dh?.session_state || "idle";
            return (
              <button
                key={d.id}
                onClick={() => {
                  setSel(d.id);
                  setDrawerOpen(false);
                }}
                aria-current={isSel ? "true" : undefined}
                className={`w-full flex items-start gap-[10px] px-2 py-[9px] rounded-xl text-left transition-colors ${
                  isSel ? "bg-[#2a2a2c]" : "hover:bg-[#1c1c1e]"
                }`}
              >
                <span
                  className="w-9 h-9 rounded-full grid place-items-center text-[15px] font-semibold shrink-0"
                  style={{ background: avatarBg(d.id) }}
                  aria-hidden="true"
                >
                  {(d.voice_prefix[0] || "?").toUpperCase()}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-[6px]">
                    <span className="text-[13.5px] font-semibold leading-tight truncate">
                      {d.voice_prefix}
                    </span>
                    <span className="ml-auto text-[11px] text-[#636366] shrink-0">
                      {fmtTime(dh?.updated_at || d.updated_at)}
                    </span>
                  </span>
                  <span className="flex items-center gap-[6px] mt-[3px]">
                    <span
                      className={`text-[10.5px] px-[6px] py-[1px] rounded-md ${
                        state === "session" || state === "running"
                          ? "bg-[rgba(48,209,88,0.15)] text-[#30d158]"
                          : state === "idle"
                            ? "bg-[#2c2c2e] text-[#98989d]"
                            : "bg-[rgba(245,158,11,0.15)] text-[#f59e0b]"
                      }`}
                    >
                      {state}
                    </span>
                    <span className="text-[12px] text-[#98989d] truncate">
                      {(dh?.swipes ?? 0).toLocaleString("en-US")} swipes
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
          {farmLoaded && !farmError && devices.length > 0 && filtered.length === 0 && (
            <div className="px-3 py-4 text-[12.5px] text-[#636366]">No device matches.</div>
          )}
        </div>

        <div className="px-2 pb-3 pt-1">
          <button
            onClick={() => {
              setAddPrefix("");
              setAddError("");
              setModal("add");
              setDrawerOpen(false);
            }}
            className="w-full flex items-center gap-[10px] px-2 py-[8px] rounded-xl hover:bg-[#1c1c1e] text-left transition-colors"
          >
            <span
              className="w-7 h-7 rounded-full border border-dashed border-[#48484a] grid place-items-center text-[#98989d]"
              aria-hidden="true"
            >
              +
            </span>
            <span className="text-[13.5px] font-medium text-[#98989d]">Add device</span>
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="h-dvh flex flex-col bg-[#0d0d0f] text-[#f5f5f7] overflow-hidden">
      {/* Titlebar */}
      <header className="h-12 shrink-0 flex items-center gap-3 pl-3 pr-4 border-b border-[#1c1c1e]">
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open device list"
          className="md:hidden w-8 h-8 rounded-lg hover:bg-[#1c1c1e] grid place-items-center text-[#98989d]"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <OctagonMark />
        <span className="text-[13px] font-semibold text-[#98989d] tracking-wide">Octagon</span>

        <div className="ml-auto flex items-center gap-4">
          <span
            className={`flex items-center gap-1.5 text-[12px] ${
              farmLoaded && hubRunning ? "text-[#98989d]" : "text-[#636366]"
            }`}
            title={hub?.ts ? `Hub heartbeat: ${hub.ts}` : "No hub heartbeat recorded"}
          >
            {farmLoaded && hubRunning && (
              <span className="w-[7px] h-[7px] rounded-full bg-[#30d158]" aria-hidden="true" />
            )}
            {!farmLoaded ? "Checking hub" : hubRunning ? "Hub running" : "Hub not running"}
          </span>
          <button
            onClick={openSettings}
            aria-label="Settings"
            title="Settings"
            className="w-8 h-8 rounded-lg hover:bg-[#1c1c1e] grid place-items-center text-[#98989d] hover:text-[#f5f5f7] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar (desktop) */}
        <aside className="hidden md:flex w-[275px] shrink-0 bg-[#111113] border-r border-[#1c1c1e] flex-col">
          {sidebarContent()}
        </aside>

        {/* Chat */}
        <main className="flex-1 min-w-0 flex flex-col bg-[#0d0d0f]">
          <div className="h-[52px] shrink-0 flex items-center gap-[10px] px-4 md:px-5">
            {device ? (
              <>
                <button
                  onClick={() => setModal("details")}
                  aria-label={`Open details for ${device.voice_prefix}`}
                  className="flex items-center gap-[10px] min-w-0 rounded-lg"
                >
                  <span
                    className="w-[34px] h-[34px] rounded-full grid place-items-center text-[14px] font-semibold shrink-0"
                    style={{ background: avatarBg(device.id) }}
                    aria-hidden="true"
                  >
                    {(device.voice_prefix[0] || "?").toUpperCase()}
                  </span>
                  <span className="leading-tight min-w-0 text-left">
                    <span className="block text-[14px] font-semibold truncate">
                      {device.voice_prefix}
                    </span>
                    <span className="block text-[12px] text-[#636366] truncate">{device.id}</span>
                  </span>
                </button>
                <span className="ml-auto text-[11.5px] text-[#98989d] shrink-0">
                  {h?.session_state || "idle"} · {(h?.swipes ?? 0).toLocaleString("en-US")} swipes
                </span>
              </>
            ) : (
              <span className="text-[13px] text-[#636366]">Octagon</span>
            )}
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-6 pb-4">
            {msgError && (
              <p className="text-center text-[12px] text-[#98989d] py-3" role="alert">
                Could not load messages for this device.
              </p>
            )}
            {!device && (
              <div className="h-full grid place-items-center">
                <p className="text-[13px] text-[#636366] text-center px-6">
                  Add a device to start chatting.
                </p>
              </div>
            )}
            {device && !msgError && msgs.length === 0 && (
              <div className="h-full grid place-items-center">
                <p className="text-[13px] text-[#636366] text-center px-6">
                  No messages yet. Try {'"run 20"'}, {'"status"'}, or {'"stop"'}.
                </p>
              </div>
            )}
            {msgs.map((m, i) => {
              const showDay = i === 0 || dayKey(m.ts) !== dayKey(msgs[i - 1].ts);
              return (
                <div key={m.ts + ":" + i} className="mb-4">
                  {showDay && (
                    <div className="flex justify-center py-2 mb-2">
                      <span className="text-[11px] text-[#636366] bg-[#1b1b1d] rounded-full px-3 py-1">
                        {dayLabel(m.ts)}
                      </span>
                    </div>
                  )}
                  <div
                    className={`text-[11px] text-[#636366] mb-[6px] ${
                      m.side === "right" ? "text-right pr-1" : "pl-1"
                    }`}
                  >
                    {fmtTime(m.ts)}
                  </div>
                  <div
                    className={`max-w-[85%] md:max-w-[68%] rounded-[18px] px-[14px] py-[10px] text-[13.5px] leading-[1.5] whitespace-pre-wrap break-words ${
                      m.side === "right" ? "ml-auto bg-[#323236]" : "bg-[#26262a]"
                    } ${m.side === "left" && m.level === "error" ? "border-l-2 border-[#ff453a]" : ""}`}
                  >
                    {m.text}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Composer */}
          <div className="px-4 pb-4">
            {sendError && (
              <p className="text-[12px] text-[#ff453a] mb-2" role="alert">
                {sendError}
              </p>
            )}
            <div className="flex items-center gap-2 bg-[#1b1b1d] border border-[#2c2c2e] rounded-full pl-4 pr-2 py-[7px]">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                disabled={!device}
                placeholder={
                  device
                    ? `Message ${device.voice_prefix} - try "run 20", "status", or "stop"`
                    : "Add a device first"
                }
                aria-label="Message input"
                className="flex-1 min-w-0 bg-transparent outline-none text-[13.5px] placeholder:text-[#636366] disabled:opacity-50"
              />
              <button
                onClick={toggleMic}
                disabled={!micOk || !device}
                title={micOk ? (listening ? "Stop dictation" : "Dictate") : "Not supported in this browser"}
                aria-label={micOk ? (listening ? "Stop dictation" : "Start dictation") : "Dictation not supported in this browser"}
                aria-pressed={listening}
                className={`w-[30px] h-[30px] rounded-full grid place-items-center shrink-0 transition-colors ${
                  listening
                    ? "bg-[#30d158] text-black"
                    : "bg-[#f5f5f7] text-black hover:bg-white"
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <MicIcon />
              </button>
            </div>
          </div>
        </main>

        {/* Device panel (desktop) */}
        {device && (
          <aside className="hidden lg:flex w-[340px] shrink-0 bg-[#111113] border-l border-[#1c1c1e] flex-col overflow-y-auto">
            <div className="px-5 py-5">
              <p className="text-[12.5px] text-[#98989d] text-center mb-2">
                Screen of {device.voice_prefix}
              </p>
              <button
                onClick={() => setModal("details")}
                className="w-full aspect-[4/3] bg-[#1a1a1c] border border-[#2c2c2e] rounded-xl grid place-items-center hover:border-[#48484a] transition-colors px-6"
              >
                <span className="flex flex-col items-center gap-2 text-center">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#636366" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                    <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
                    <path d="M3 3l18 18" />
                  </svg>
                  <span className="text-[13px] font-medium text-[#98989d]">
                    Screen capture not connected
                  </span>
                  <span className="text-[11.5px] text-[#636366] leading-relaxed">
                    Live screen capture requires libimobiledevice and the device UDID (see setup
                    guide).
                  </span>
                </span>
              </button>

              <div className="mt-5 text-[13px]">
                <DetailRow label="State" value={h?.session_state || "idle"} />
                <DetailRow label="Swipes" value={(h?.swipes ?? 0).toLocaleString("en-US")} />
                <DetailRow
                  label="Last action"
                  value={h?.last_action ? `${h.last_action}, ${fmtTime(h.last_action_at)}` : "none"}
                />
                <DetailRow label="USB connected" value={h?.usb_connected ? "Yes" : "No"} />
              </div>

              {h?.error && (
                <div
                  className="mt-3 rounded-xl border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.1)] px-3 py-2 text-[12.5px] text-[#f59e0b] break-words"
                  role="alert"
                >
                  {h.error}
                </div>
              )}

              <div className="flex items-center justify-between mt-6 mb-2">
                <span className="text-[15px] font-semibold">Sessions</span>
              </div>
              {tasksError && (
                <p className="text-[12px] text-[#98989d] py-1" role="alert">
                  Could not load sessions.
                </p>
              )}
              <div className="space-y-[6px]">
                {deviceTasks.map((t) => {
                  const mins = parseDuration(t.payload);
                  return (
                    <div key={t.id} className="px-2 py-[8px] rounded-xl hover:bg-[#1c1c1e]">
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] font-medium truncate flex-1 min-w-0">
                          Pacing session{mins !== null ? ` - ${mins} min` : ""}
                        </span>
                        <span
                          className={`text-[10.5px] px-[7px] py-[2px] rounded-md shrink-0 ${
                            STATUS_CHIP[t.status]
                          }`}
                        >
                          {t.status}
                        </span>
                      </div>
                      <div className="text-[12px] text-[#98989d] mt-[2px]">
                        {fmtTime(t.scheduled_for)}
                      </div>
                      {t.status === "failed" && t.error && (
                        <div
                          className="mt-1 text-[12px] text-[#ff453a] break-words"
                          role="alert"
                        >
                          {t.error}
                        </div>
                      )}
                    </div>
                  );
                })}
                {!tasksError && deviceTasks.length === 0 && (
                  <p className="text-[12.5px] text-[#636366] px-2 py-1">No sessions yet.</p>
                )}
              </div>

              <button
                onClick={() => {
                  setSessionMinutes("");
                  setSessionError("");
                  setModal("session");
                }}
                className="mt-4 mb-2 w-full bg-[#f5f5f7] hover:bg-white text-black rounded-full py-[9px] text-[13.5px] font-semibold transition-colors"
              >
                New session
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setDrawerOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Devices"
            className="absolute left-0 top-0 bottom-0 w-[280px] max-w-[85vw] bg-[#111113] border-r border-[#1c1c1e] flex flex-col"
          >
            {sidebarContent()}
          </div>
        </div>
      )}

      {/* Device details modal */}
      {modal === "details" && device && (
        <Modal title={`${device.voice_prefix} - device details`} onClose={() => setModal(null)}>
          <div className="p-4 text-[13px]">
            <DetailRow label="Name" value={device.voice_prefix} />
            <DetailRow label="Device ID" value={device.id} />
            <DetailRow label="USB UDID" value={device.usb_udid || "not set"} />
            <DetailRow label="State" value={h?.session_state || "idle"} />
            <DetailRow label="Swipes" value={(h?.swipes ?? 0).toLocaleString("en-US")} />
            <DetailRow
              label="Last action"
              value={h?.last_action ? `${h.last_action}, ${fmtTime(h.last_action_at)}` : "none"}
            />
            <DetailRow label="USB connected" value={h?.usb_connected ? "Yes" : "No"} />
            <DetailRow label="Jitter variance" value={String(h?.jitter_variance ?? "-")} />
            <DetailRow label="Health updated" value={fmtTime(h?.updated_at)} />
            {h?.error && (
              <div
                className="mt-3 rounded-xl border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.1)] px-3 py-2 text-[12.5px] text-[#f59e0b] break-words"
                role="alert"
              >
                {h.error}
              </div>
            )}
            <p className="mt-4 text-[11.5px] text-[#636366] leading-relaxed">
              Screen capture is not connected. Live screen capture requires libimobiledevice and
              the device UDID (see setup guide).
            </p>
            <button
              onClick={() => setModal(null)}
              className="mt-4 w-full bg-[#2c2c2e] hover:bg-[#3a3a3c] rounded-full py-[9px] text-[13.5px] font-semibold transition-colors"
            >
              Close
            </button>
          </div>
        </Modal>
      )}

      {/* Add device modal */}
      {modal === "add" && (
        <Modal title="Add device" onClose={closeAndResetAdd} maxWidth={360}>
          <div className="p-4 space-y-3">
            <label htmlFor="prefix" className="block text-[12px] text-[#98989d]">
              Voice prefix
            </label>
            <input
              id="prefix"
              value={addPrefix}
              onChange={(e) => setAddPrefix(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addDevice();
              }}
              placeholder="e.g. Alpha"
              autoFocus
              className="w-full bg-[#1b1b1d] border border-[#2c2c2e] rounded-lg px-3 py-[8px] text-[13.5px] placeholder:text-[#636366] focus:outline-none focus:border-[#48484a]"
            />
            <p className="text-[11.5px] text-[#636366] leading-relaxed">
              {`On the iPhone, create a Voice Control custom command named "${
                addPrefix.trim() || "Alpha"
              } Swipe Next" that performs a swipe-up.`}
            </p>
            {addError && (
              <p className="text-[12px] text-[#ff453a]" role="alert">
                {addError}
              </p>
            )}
            <button
              onClick={addDevice}
              disabled={adding || addPrefix.trim().length < 2}
              className="w-full bg-[#f5f5f7] hover:bg-white disabled:opacity-40 text-black rounded-full py-[9px] text-[13.5px] font-semibold transition-colors"
            >
              {adding ? "Adding" : "Add device"}
            </button>
          </div>
        </Modal>
      )}

      {/* New session modal */}
      {modal === "session" && device && (
        <Modal title={`New session - ${device.voice_prefix}`} onClose={() => setModal(null)} maxWidth={360}>
          <div className="p-4 space-y-3">
            <span className="block text-[12px] text-[#98989d]">Duration (minutes)</span>
            <div className="flex flex-wrap gap-2">
              {SESSION_PRESETS.map((n) => (
                <button
                  key={n}
                  onClick={() => setSessionMinutes(String(n))}
                  aria-pressed={sessionMinutes === String(n)}
                  className={`px-3 py-[6px] rounded-full text-[13px] border transition-colors ${
                    sessionMinutes === String(n)
                      ? "bg-[#2a2a2c] border-[#48484a] text-[#f5f5f7]"
                      : "bg-[#1b1b1d] border-[#2c2c2e] text-[#98989d] hover:border-[#48484a]"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={180}
                value={sessionMinutes}
                onChange={(e) => setSessionMinutes(e.target.value)}
                placeholder="Custom"
                aria-label="Custom duration in minutes"
                className="w-full bg-[#1b1b1d] border border-[#2c2c2e] rounded-lg px-3 py-[8px] text-[13.5px] placeholder:text-[#636366] focus:outline-none focus:border-[#48484a]"
              />
              <span className="text-[12px] text-[#636366] shrink-0">min</span>
            </div>
            <p className="text-[11.5px] text-[#636366] leading-relaxed">
              The session runs while the hub is up. In dry-run mode nothing is spoken aloud.
            </p>
            {sessionError && (
              <p className="text-[12px] text-[#ff453a]" role="alert">
                {sessionError}
              </p>
            )}
            <button
              onClick={scheduleSession}
              disabled={sessionPosting}
              className="w-full bg-[#f5f5f7] hover:bg-white disabled:opacity-40 text-black rounded-full py-[9px] text-[13.5px] font-semibold transition-colors"
            >
              {sessionPosting ? "Scheduling" : "Schedule session"}
            </button>
          </div>
        </Modal>
      )}

      {/* Settings modal */}
      {modal === "settings" && (
        <Modal title="Settings" onClose={() => setModal(null)}>
          <div className="p-4 text-[13px]">
            {settingsLoading && <p className="text-[#98989d] py-2">Checking</p>}
            {!settingsLoading && settings && (
              <>
                <DetailRow
                  label="Status"
                  value={settings.status}
                  valueClass={
                    settings.status === "healthy"
                      ? "text-[#30d158]"
                      : settings.status === "degraded"
                        ? "text-[#f59e0b]"
                        : ""
                  }
                />
                <DetailRow label="Database" value={`SQLite, local: ${settings.database}`} />
                <DetailRow label="Devices" value={String(devices.length)} />
                <DetailRow
                  label="Cloud"
                  value="None - everything stays on this Mac"
                  valueClass="text-[#30d158]"
                />
                <DetailRow
                  label="Checked at"
                  value={
                    settings.timestamp
                      ? new Date(settings.timestamp).toLocaleString("en-US")
                      : "-"
                  }
                />
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
