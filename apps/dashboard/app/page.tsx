"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Play,
  CircleCheck,
  UserRound,
  Plus,
  MoreHorizontal,
  Database,
  Clock,
  Link as LinkIcon,
  Search,
  FileText,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import {
  TitleBar,
  StatusChip,
  DeviceAvatar,
  EventMessage,
  Composer,
} from "@/components/ui";
import { PhonePreview, DeviceIdentity } from "@/components/inspector";

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

// Avatar colors are keyed by device id so a device keeps its color even if the
// list reorders. Alpha/Bravo/Charlie/Delta follow the approved reference; any
// other device gets a stable color derived from its id.
const AVATAR_COLORS: Record<string, string> = {
  phone1: "#F59E0B", // Alpha - orange
  phone2: "#8E8E93", // Bravo - gray
  phone3: "#8B5CF6", // Charlie - purple
  phone4: "#3B82F6", // Delta - blue
};
const AVATAR_PALETTE = [
  "#F59E0B",
  "#8E8E93",
  "#8B5CF6",
  "#3B82F6",
  "#14B8A6",
  "#EC4899",
  "#22C55E",
  "#6366F1",
];

function avatarColor(id: string): string {
  const known = AVATAR_COLORS[id];
  if (known) return known;
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return AVATAR_PALETTE[sum % AVATAR_PALETTE.length];
}

// Phone artwork persists by device id for the same reason.
const PHONE_ARTWORK: Record<string, string> = {
  phone1: "/phones/phone-indigo.png",
  phone2: "/phones/phone-bronze.png",
  phone3: "/phones/phone-purple.png",
  phone4: "/phones/phone-blue.png",
};

function artworkFor(id: string): string {
  return PHONE_ARTWORK[id] ?? "/phones/phone-graphite.png";
}

const SESSION_PRESETS = [5, 10, 15, 30, 60];

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

// Farm health states ("session", "idle", ...) mapped onto the StatusChip states.
function deviceChipState(raw: string | undefined): "running" | "idle" | "offline" {
  const s = (raw || "idle").toLowerCase();
  if (s === "session" || s === "running" || s === "active") return "running";
  if (s === "idle") return "idle";
  return "offline";
}

// Task statuses mapped onto the StatusChip states. "canceled" has no chip
// state, so it is rendered as a plain neutral chip below (never relabeled).
function taskChipState(
  status: Task["status"],
): "scheduled" | "running" | "completed" | "failed" | null {
  if (status === "scheduled") return "scheduled";
  if (status === "running") return "running";
  if (status === "succeeded") return "completed";
  if (status === "failed") return "failed";
  return null;
}

// Icon per event kind: Activity for hub/status lines, Play for session start,
// CircleCheck for session finished / queued confirmation, UserRound for user
// commands. Rendered as an element: EventMessage takes a ReactNode.
function eventIcon(m: ChatMsg): React.ReactNode {
  const Icon: LucideIcon = m.side === "right" ? UserRound : iconForText(m.text);
  return <Icon size={16} strokeWidth={1.75} aria-hidden="true" />;
}

function iconForText(text: string): LucideIcon {
  const t = text.toLowerCase();
  if (t.startsWith("session start")) return Play;
  if (
    t.startsWith("session done") ||
    t.startsWith("session finished") ||
    t.startsWith("session stopped") ||
    t.startsWith("task succeeded") ||
    t.startsWith("queued a")
  ) {
    return CircleCheck;
  }
  return Activity;
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
        className="w-full bg-surface border border-hairline rounded-composer shadow-2xl overflow-hidden"
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-11 flex items-center justify-between px-4 border-b border-hairline">
          <span className="text-[13px] font-semibold text-ink">{title}</span>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="w-6 h-6 rounded-full bg-raised grid place-items-center text-ink-mute hover:text-ink text-[11px] leading-none transition-colors"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  valueClass = "",
}: {
  icon?: LucideIcon;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-[9px] text-[12.5px]">
      {Icon && <Icon size={14} strokeWidth={1.75} className="text-ink-mute shrink-0" aria-hidden="true" />}
      <span className="text-ink-dim shrink-0">{label}</span>
      <span className={`ml-auto text-right tnum break-words min-w-0 text-ink ${valueClass}`}>{value}</span>
    </div>
  );
}

export default function OctagonChat() {
  const router = useRouter();
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
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const [modal, setModal] = useState<null | "details" | "add" | "settings" | "session">(null);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [addPrefix, setAddPrefix] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);
  const [sessionMinutes, setSessionMinutes] = useState<string>("");
  const [sessionError, setSessionError] = useState("");
  const [sessionPosting, setSessionPosting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const nearBottomRef = useRef(true);
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
  const hubState: "running" | "down" | "checking" = !farmLoaded
    ? "checking"
    : hubRunning
      ? "running"
      : "down";

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

  // Jump to the bottom when switching devices; afterwards only follow new
  // events while the reader is already near the bottom.
  useEffect(() => {
    nearBottomRef.current = true;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [sel]);

  useEffect(() => {
    if (nearBottomRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [msgs.length]);

  function handleFeedScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  // The search field advertises Cmd K, so it actually focuses on Cmd K.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  async function send(text: string) {
    const body = text.trim();
    if (!body || sending || !device) return;
    setSendError("");
    setSending(true);
    try {
      const res = await fetch("/api/farm/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: device.id, text: body }),
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

  // ---- device rail (left column) ----
  function railContent() {
    return (
      <>
        <div className="px-3 pt-4 pb-2">
          <div className="relative">
            <Search
              size={14}
              strokeWidth={1.75}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute"
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search devices..."
              aria-label="Search devices"
              className="w-full bg-raised border border-hairline rounded-control pl-9 pr-14 py-[7px] text-[13px] text-ink placeholder:text-ink-mute focus:outline-none focus:border-accent transition-colors"
            />
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[10.5px] leading-none text-ink-mute bg-hover border border-hairline rounded px-1.5 py-1">
              ⌘ K
            </kbd>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-[2px]">
          {farmError === "auth" && (
            <div className="px-3 py-4 text-[12.5px] text-ink-dim leading-relaxed">
              Sign in required.
              <br />
              <Link href="/login" className="text-ink underline underline-offset-2">
                Go to login
              </Link>
            </div>
          )}
          {farmError === "error" && (
            <div className="px-3 py-4 text-[12.5px] text-ink-dim leading-relaxed">
              Could not load devices.
              <br />
              <span className="text-ink-mute break-words">{farmErrorMsg}</span>
            </div>
          )}
          {farmLoaded && !farmError && devices.length === 0 && (
            <div className="px-3 py-4 text-[12.5px] text-ink-dim leading-relaxed">
              <p>No devices yet. Add one, or run:</p>
              <code className="block mt-2 bg-raised border border-hairline rounded-control px-2 py-[6px] text-[11.5px] text-ink break-all">
                node scripts/seed-demo.js
              </code>
            </div>
          )}
          {filtered.map((d) => {
            const dh = health.find((x) => x.device_id === d.id) ?? null;
            const isSel = d.id === device?.id;
            return (
              <button
                key={d.id}
                onClick={() => setSel(d.id)}
                aria-current={isSel ? "true" : undefined}
                className={`relative w-full flex items-start gap-[10px] px-2.5 py-[9px] rounded-control text-left transition-colors ${
                  isSel ? "bg-selected" : "hover:bg-hover"
                }`}
              >
                {isSel && (
                  <span
                    className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-accent"
                    aria-hidden="true"
                  />
                )}
                <DeviceAvatar name={d.voice_prefix} color={avatarColor(d.id)} size={40} />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-[6px]">
                    <span className="text-[13.5px] font-semibold leading-tight truncate text-ink">
                      {d.voice_prefix}
                    </span>
                    <span className="ml-auto text-[11px] text-ink-mute tnum shrink-0">
                      {fmtTime(dh?.updated_at || d.updated_at)}
                    </span>
                  </span>
                  <span className="flex items-center gap-[6px] mt-[4px]">
                    <StatusChip state={deviceChipState(dh?.session_state)} />
                    <span className="text-[12px] text-ink-dim tnum truncate">
                      {(dh?.swipes ?? 0).toLocaleString("en-US")} swipes
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
          {farmLoaded && !farmError && devices.length > 0 && filtered.length === 0 && (
            <div className="px-3 py-4 text-[12.5px] text-ink-mute">No device matches.</div>
          )}
        </div>

        <div className="px-3 pb-3 pt-1">
          <button
            onClick={() => {
              setAddPrefix("");
              setAddError("");
              setModal("add");
            }}
            className="w-full flex items-center gap-[10px] px-2.5 py-2 rounded-control bg-surface border border-hairline hover:bg-hover text-left transition-colors"
          >
            <span
              className="w-7 h-7 rounded-full bg-raised grid place-items-center text-ink-dim shrink-0"
              aria-hidden="true"
            >
              <Plus size={15} strokeWidth={1.75} />
            </span>
            <span className="text-[13.5px] font-medium text-ink-dim">Add device</span>
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="h-dvh flex flex-col bg-canvas text-ink overflow-hidden">
      <TitleBar
        hub={hubState}
        view="conversation"
        onViewChange={(v) => router.push(v === "fleet" ? "/dashboard" : "/")}
        onOpenSettings={openSettings}
      />

      <div className="flex flex-1 min-h-0">
        {/* Device rail */}
        <aside className="hidden md:flex w-[280px] shrink-0 bg-sidebar border-r border-hairline flex-col">
          {railContent()}
        </aside>

        {/* Conversation */}
        <main className="flex-1 min-w-0 flex flex-col bg-canvas">
          <div className="h-[64px] shrink-0 flex items-center gap-3 px-5">
            {device ? (
              <>
                {/* Screen capture never exists in this build, so the header
                    shows the colored initial avatar, not artwork. */}
                <DeviceIdentity
                  name={device.voice_prefix}
                  sub={device.id}
                  artwork={null}
                  color={avatarColor(device.id)}
                />
                <div className="ml-auto flex items-center gap-2.5 shrink-0">
                  <StatusChip state={deviceChipState(h?.session_state)} />
                  <span className="text-[12px] text-ink-dim tnum">
                    {(h?.swipes ?? 0).toLocaleString("en-US")} swipes
                  </span>
                  <div className="relative">
                    <button
                      onClick={() => setMenuOpen((o) => !o)}
                      aria-label={`Menu for ${device.voice_prefix}`}
                      aria-expanded={menuOpen}
                      className="w-8 h-8 rounded-control grid place-items-center text-ink-mute hover:text-ink hover:bg-hover transition-colors"
                    >
                      <MoreHorizontal size={16} strokeWidth={1.75} />
                    </button>
                    {menuOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setMenuOpen(false)}
                          aria-hidden="true"
                        />
                        <div className="absolute right-0 top-9 z-20 min-w-[170px] bg-surface border border-hairline rounded-control shadow-2xl py-1">
                          <button
                            onClick={() => {
                              setMenuOpen(false);
                              setModal("details");
                            }}
                            className="w-full text-left px-3 py-2 text-[13px] text-ink hover:bg-hover transition-colors"
                          >
                            Device details
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <span className="text-[13px] text-ink-mute">Octagon</span>
            )}
          </div>

          <div
            ref={scrollRef}
            onScroll={handleFeedScroll}
            className="flex-1 overflow-y-auto px-5 md:px-6 py-4"
          >
            {msgError && (
              <p className="text-center text-[12px] text-ink-dim py-3" role="alert">
                Could not load messages for this device.
              </p>
            )}
            {!device && (
              <div className="h-full grid place-items-center">
                <p className="text-[13px] text-ink-mute text-center px-6">
                  Add a device to start chatting.
                </p>
              </div>
            )}
            {device && !msgError && msgs.length === 0 && (
              <div className="h-full grid place-items-center">
                <p className="text-[13px] text-ink-mute text-center px-6">
                  No messages yet. Try {'"run 20"'}, {'"status"'}, or {'"stop"'}.
                </p>
              </div>
            )}
            {msgs.map((m, i) => {
              const showDay = i === 0 || dayKey(m.ts) !== dayKey(msgs[i - 1].ts);
              return (
                <div key={m.ts + ":" + i} className="mb-4">
                  {showDay && (
                    <div className="flex justify-center py-2 mb-3">
                      <span className="text-[11px] text-ink-mute bg-raised border border-hairline rounded-full px-3 py-1">
                        {dayLabel(m.ts)}
                      </span>
                    </div>
                  )}
                  <EventMessage
                    icon={eventIcon(m)}
                    text={m.text}
                    ts={fmtTime(m.ts)}
                    side={m.side === "right" ? "user" : "agent"}
                    iconTone={m.level === "error" ? "error" : "default"}
                  />
                </div>
              );
            })}
          </div>

          {/* Composer */}
          <div className="px-5 pb-4 shrink-0">
            {sendError && (
              <p className="text-[12px] text-danger mb-2" role="alert">
                {sendError}
              </p>
            )}
            <Composer
              placeholder={
                device
                  ? `Message ${device.voice_prefix} - try "run 20", "status", or "stop"`
                  : "Add a device first"
              }
              onSend={send}
              disabled={!device}
            />
          </div>
        </main>

        {/* Inspector */}
        <aside className="hidden lg:flex w-[350px] shrink-0 bg-sidebar border-l border-hairline flex-col overflow-y-auto">
          {device ? (
            <div className="px-4 py-4">
              {/* Screen preview */}
              <section>
                <h2 className="text-sm font-semibold text-ink mb-2.5">
                  Screen of {device.voice_prefix}
                </h2>
                <PhonePreview
                  artwork={artworkFor(device.id)}
                  state="unavailable"
                  note="Live screen capture requires libimobiledevice and the device UDID (see setup guide)."
                />
              </section>

              {/* Device details */}
              <section className="mt-5">
                <h2 className="text-sm font-semibold text-ink mb-2.5">Device details</h2>
                <div className="bg-surface border border-hairline rounded-card px-3.5 py-1.5">
                  <DetailRow icon={Activity} label="State" value={h?.session_state || "idle"} />
                  <DetailRow
                    icon={Database}
                    label="Swipes"
                    value={(h?.swipes ?? 0).toLocaleString("en-US")}
                  />
                  <DetailRow
                    icon={Clock}
                    label="Last action"
                    value={h?.last_action ? `${h.last_action}, ${fmtTime(h.last_action_at)}` : "none"}
                  />
                  <DetailRow
                    icon={LinkIcon}
                    label="USB connected"
                    value={h?.usb_connected ? "Yes" : "No"}
                  />
                </div>
                {h?.error && (
                  <div
                    className="mt-3 rounded-card border border-[rgba(245,165,36,0.4)] bg-[rgba(245,165,36,0.1)] px-3 py-2 text-[12.5px] text-warning break-words"
                    role="alert"
                  >
                    {h.error}
                  </div>
                )}
              </section>

              {/* Sessions */}
              <section className="mt-5">
                <div className="flex items-center justify-between mb-2.5">
                  <h2 className="text-sm font-semibold text-ink">Sessions</h2>
                  <ChevronRight size={16} strokeWidth={1.75} className="text-ink-mute" aria-hidden="true" />
                </div>
                <div className="bg-surface border border-hairline rounded-card p-3">
                  {tasksError && (
                    <p className="text-[12px] text-ink-dim py-1" role="alert">
                      Could not load sessions.
                    </p>
                  )}
                  <div className="space-y-1">
                    {deviceTasks.map((t) => {
                      const mins = parseDuration(t.payload);
                      const chip = taskChipState(t.status);
                      return (
                        <div key={t.id} className="px-2 py-[8px] rounded-control hover:bg-hover">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium truncate flex-1 min-w-0 text-ink">
                              Pacing session{mins !== null ? ` - ${mins} min` : ""}
                            </span>
                            {chip ? (
                              <StatusChip state={chip} />
                            ) : (
                              <span className="text-[10.5px] px-[7px] py-[2px] rounded-md bg-raised border border-hairline text-ink-mute shrink-0">
                                {t.status}
                              </span>
                            )}
                          </div>
                          <div className="text-[11.5px] text-ink-mute tnum mt-[2px]">
                            {fmtTime(t.scheduled_for)}
                          </div>
                          {t.status === "failed" && t.error && (
                            <div className="mt-1 text-[12px] text-danger break-words" role="alert">
                              {t.error}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {!tasksError && deviceTasks.length === 0 && (
                      <div className="flex items-start gap-3 py-1.5 px-1">
                        <span
                          className="w-9 h-9 rounded-full bg-raised grid place-items-center text-ink-mute shrink-0"
                          aria-hidden="true"
                        >
                          <FileText size={15} strokeWidth={1.75} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[12.5px] text-ink">No sessions yet.</span>
                          <span className="block text-[11.5px] text-ink-mute mt-0.5 leading-relaxed">
                            Start a new session to see activity here.
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setSessionMinutes("");
                      setSessionError("");
                      setModal("session");
                    }}
                    className="mt-3 w-full bg-white hover:bg-[#E8ECF2] text-[#0B0E12] rounded-full py-[10px] text-[13.5px] font-semibold flex items-center justify-center gap-2 transition-colors"
                  >
                    <Play size={13} fill="currentColor" aria-hidden="true" />
                    New session
                  </button>
                </div>
              </section>
            </div>
          ) : (
            <p className="text-[13px] text-ink-mute px-4 py-6">
              Add a device to see its screen, details and sessions.
            </p>
          )}
        </aside>
      </div>

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
                className="mt-3 rounded-card border border-[rgba(245,165,36,0.4)] bg-[rgba(245,165,36,0.1)] px-3 py-2 text-[12.5px] text-warning break-words"
                role="alert"
              >
                {h.error}
              </div>
            )}
            <p className="mt-4 text-[11.5px] text-ink-mute leading-relaxed">
              Screen capture is not connected. Live screen capture requires libimobiledevice and
              the device UDID (see setup guide).
            </p>
            <button
              onClick={() => setModal(null)}
              className="mt-4 w-full border border-hairline text-ink hover:bg-hover rounded-full py-[9px] text-[13.5px] font-semibold transition-colors"
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
            <label htmlFor="prefix" className="block text-[12px] text-ink-dim">
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
              className="w-full bg-raised border border-hairline rounded-control px-3 py-[8px] text-[13.5px] text-ink placeholder:text-ink-mute focus:outline-none focus:border-accent transition-colors"
            />
            <p className="text-[11.5px] text-ink-mute leading-relaxed">
              {`On the iPhone, create a Voice Control custom command named "${
                addPrefix.trim() || "Alpha"
              } Swipe Next" that performs a swipe-up.`}
            </p>
            {addError && (
              <p className="text-[12px] text-danger" role="alert">
                {addError}
              </p>
            )}
            <button
              onClick={addDevice}
              disabled={adding || addPrefix.trim().length < 2}
              className="w-full bg-white hover:bg-[#E8ECF2] disabled:opacity-40 text-[#0B0E12] rounded-full py-[9px] text-[13.5px] font-semibold transition-colors"
            >
              {adding ? "Adding" : "Add device"}
            </button>
          </div>
        </Modal>
      )}

      {/* New session modal */}
      {modal === "session" && device && (
        <Modal
          title={`New session - ${device.voice_prefix}`}
          onClose={() => setModal(null)}
          maxWidth={360}
        >
          <div className="p-4 space-y-3">
            <span className="block text-[12px] text-ink-dim">Duration (minutes)</span>
            <div className="flex flex-wrap gap-2">
              {SESSION_PRESETS.map((n) => (
                <button
                  key={n}
                  onClick={() => setSessionMinutes(String(n))}
                  aria-pressed={sessionMinutes === String(n)}
                  className={`px-3 py-[6px] rounded-full text-[13px] border transition-colors ${
                    sessionMinutes === String(n)
                      ? "bg-hover border-accent text-ink"
                      : "bg-raised border-hairline text-ink-dim hover:border-hairline-strong"
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
                className="w-full bg-raised border border-hairline rounded-control px-3 py-[8px] text-[13.5px] text-ink placeholder:text-ink-mute focus:outline-none focus:border-accent transition-colors"
              />
              <span className="text-[12px] text-ink-mute shrink-0">min</span>
            </div>
            <p className="text-[11.5px] text-ink-mute leading-relaxed">
              The session runs while the hub is up. In dry-run mode nothing is spoken aloud.
            </p>
            {sessionError && (
              <p className="text-[12px] text-danger" role="alert">
                {sessionError}
              </p>
            )}
            <button
              onClick={scheduleSession}
              disabled={sessionPosting}
              className="w-full bg-white hover:bg-[#E8ECF2] disabled:opacity-40 text-[#0B0E12] rounded-full py-[9px] text-[13.5px] font-semibold transition-colors"
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
            {settingsLoading && <p className="text-ink-dim py-2">Checking</p>}
            {!settingsLoading && settings && (
              <>
                <DetailRow
                  label="Status"
                  value={settings.status}
                  valueClass={
                    settings.status === "healthy"
                      ? "text-success"
                      : settings.status === "degraded"
                        ? "text-warning"
                        : ""
                  }
                />
                <DetailRow label="Database" value={`SQLite, local: ${settings.database}`} />
                <DetailRow label="Devices" value={String(devices.length)} />
                <DetailRow
                  label="Cloud"
                  value="None - everything stays on this Mac"
                  valueClass="text-accent"
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
