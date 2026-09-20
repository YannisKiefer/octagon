"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Battery,
  ChevronDown,
  CircleCheck,
  Clock,
  Database,
  HeartPulse,
  MonitorSmartphone,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RotateCw,
  Search,
  Smartphone,
  Thermometer,
  TrendingDown,
  TrendingUp,
  Usb,
} from "lucide-react";
import {
  EventMessage,
  MetricCard,
  SectionCard,
  StatusChip,
  TitleBar,
} from "@/components/ui";
import { DeviceIdentity, PhonePreview } from "@/components/inspector";
import type { FarmDevice, FarmDeviceHealth } from "@/lib/farmTypes";

// Octagon fleet view - devices, metrics and the activity queue.
// Every number comes from /api/farm and /api/farm/summary. When the runtime
// does not know something (battery, temperature, deltas, charts) the page says
// so instead of inventing data.

type ChipState = React.ComponentProps<typeof StatusChip>["state"];

// "canceled" has no dedicated chip variant; StatusChip falls back to a muted
// generic pill for unknown states, which is the honest rendering for it.
const CANCELED_CHIP = "canceled" as unknown as ChipState;

type SummaryQueueItem = {
  id: string;
  title: string;
  device: string;
  status: string;
  createdAt: string;
};

type SummaryEvent = {
  id: string;
  ts: string;
  deviceId: string;
  text: string;
};

type FarmSummary = {
  success: boolean;
  ts: string;
  devices: { online: number; total: number };
  sessions: { active: number; startedInRange: number };
  swipes: { count: number; deltaPct: number | null };
  successRate: { pct: number | null; sampleCount: number };
  avgCycleTime: { seconds: number | null; sampleCount: number };
  queue: SummaryQueueItem[];
  recentEvents: SummaryEvent[];
};

type HubStatus = { active: number; ts: string };

type SettingsData = {
  status: string;
  database: string;
  timestamp: string;
  reachable: boolean;
};

const SESSION_PRESETS = [5, 10, 15, 30, 60];
const MAX_MINUTES = 480;

const RANGES = [
  { hours: 1, label: "Last hour", short: "1h" },
  { hours: 24, label: "Last 24 hours", short: "24h" },
  { hours: 168, label: "Last 7 days", short: "7d" },
] as const;

type RangeHours = (typeof RANGES)[number]["hours"];

// Phone artwork, assigned per device in list order and then remembered by
// device id so a row keeps its artwork across polls and reorders.
const ARTWORK_SEQUENCE = [
  { src: "/phones/phone-indigo.png", color: "#6366F1" },
  { src: "/phones/phone-bronze.png", color: "#C58E5B" },
  { src: "/phones/phone-purple.png", color: "#A855F7" },
  { src: "/phones/phone-blue.png", color: "#3B82F6" },
];
const ARTWORK_GRAPHITE = { src: "/phones/phone-graphite.png", color: "#64748B" };
type Artwork = { src: string; color: string };

// Relative for anything younger than a day ("7m ago"), clock-and-date after.
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

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function deviceName(d: FarmDevice | undefined): string {
  if (!d) return "Unknown device";
  return d.display_name?.trim() || d.voice_prefix || d.id;
}

// Real health to the three honest buckets behind both the rail chips and the
// Online / Idle / Offline filters: offline is no health row or no USB,
// online means a live session, everything else is idle.
function bucketOf(h: FarmDeviceHealth | undefined | null): "online" | "idle" | "offline" {
  if (!h || !h.usb_connected) return "offline";
  const s = String(h.session_state || "").toLowerCase();
  return s === "session" || s === "running" || s === "active" ? "online" : "idle";
}

function chipForBucket(b: "online" | "idle" | "offline"): ChipState {
  return b === "online" ? "running" : b;
}

function taskChipState(s: string): ChipState {
  switch (s) {
    case "running":
      return "running";
    case "succeeded":
      return "completed";
    case "failed":
      return "failed";
    case "canceled":
      return CANCELED_CHIP;
    default:
      return "queued";
  }
}

function fmtCycle(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function Modal({
  title,
  onClose,
  children,
  maxWidth = 400,
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full overflow-hidden rounded-composer border border-hairline-strong bg-surface shadow-2xl"
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-12 items-center justify-between border-b border-hairline px-4">
          <span className="text-[13px] font-semibold text-ink">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="grid h-6 w-6 place-items-center rounded-full bg-raised text-[11px] leading-none text-ink-dim hover:text-ink"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* Green / red delta pill. Rendered only when the API actually provides a
   delta percentage; a flat period shows a muted "0%". */
function DeltaChip({ pct }: { pct: number }) {
  const rounded = Math.round(pct);
  const dir = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
  const color =
    dir === "up" ? "var(--success)" : dir === "down" ? "var(--error)" : "var(--text-muted)";
  const bg =
    dir === "up"
      ? "rgba(48, 209, 88, 0.12)"
      : dir === "down"
        ? "rgba(249, 112, 112, 0.12)"
        : "rgba(127, 139, 155, 0.12)";
  return (
    <span
      className="tnum inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ color, backgroundColor: bg }}
    >
      {dir === "up" ? (
        <TrendingUp size={12} strokeWidth={2} aria-hidden="true" />
      ) : dir === "down" ? (
        <TrendingDown size={12} strokeWidth={2} aria-hidden="true" />
      ) : null}
      {rounded > 0 ? `+${rounded}%` : `${rounded}%`}
    </span>
  );
}

function DetailRow({
  icon,
  label,
  value,
  tone,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: "default" | "success" | "error" | "muted";
  title?: string;
}) {
  const color =
    tone === "success"
      ? "var(--success)"
      : tone === "error"
        ? "var(--error)"
        : tone === "muted"
          ? "var(--text-muted)"
          : undefined;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-[9px] text-[13px]">
      <span className="flex shrink-0 items-center gap-2.5 text-ink-mute">
        <span className="inline-flex" aria-hidden="true">
          {icon}
        </span>
        {label}
      </span>
      <span
        className="tnum min-w-0 truncate text-right font-medium text-ink"
        style={color ? { color } : undefined}
        title={title}
      >
        {value}
      </span>
    </div>
  );
}

export default function FleetDashboard() {
  const router = useRouter();

  // Farm data (devices, health, hub heartbeat).
  const [devices, setDevices] = useState<FarmDevice[]>([]);
  const [health, setHealth] = useState<FarmDeviceHealth[]>([]);
  const [hub, setHub] = useState<HubStatus | null>(null);
  const [farmLoaded, setFarmLoaded] = useState(false);
  const [farmError, setFarmError] = useState<null | "auth" | "error">(null);
  const [farmErrorMsg, setFarmErrorMsg] = useState("");

  // Summary data (metrics, queue, events).
  const [summary, setSummary] = useState<FarmSummary | null>(null);
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  const [summaryError, setSummaryError] = useState<null | "auth" | "error">(null);

  const [range, setRange] = useState<RangeHours>(24);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [tab, setTab] = useState<"queue" | "events">("queue");

  const [sel, setSel] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "online" | "idle" | "offline">("all");

  const [now, setNow] = useState<Date | null>(null);

  const [modal, setModal] = useState<null | "session" | "add" | "settings">(null);
  const [sessionDeviceId, setSessionDeviceId] = useState("");
  const [sessionMinutes, setSessionMinutes] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [sessionPosting, setSessionPosting] = useState(false);

  const [addPrefix, setAddPrefix] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);

  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);

  const [menuFor, setMenuFor] = useState<string | null>(null); // queue item id
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<SummaryQueueItem | null>(null);
  const [cancelError, setCancelError] = useState("");
  const [canceling, setCanceling] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const rangeRef = useRef<RangeHours>(range);
  rangeRef.current = range;
  const farmAbortRef = useRef<AbortController | null>(null);
  const summaryAbortRef = useRef<AbortController | null>(null);
  const artworkRef = useRef<Map<string, Artwork>>(new Map());

  // ---- data loading -------------------------------------------------------

  const loadFarm = useCallback(async () => {
    farmAbortRef.current?.abort();
    const ctrl = new AbortController();
    farmAbortRef.current = ctrl;
    try {
      const res = await fetch("/api/farm", { cache: "no-store", signal: ctrl.signal });
      const j = await res.json().catch(() => null);
      if (ctrl.signal.aborted) return;
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
    } catch (e: any) {
      if (e?.name === "AbortError" || ctrl.signal.aborted) return;
      setFarmError("error");
      setFarmErrorMsg("The farm API is unreachable.");
    }
    if (!ctrl.signal.aborted) setFarmLoaded(true);
  }, []);

  const loadSummary = useCallback(async (hours: RangeHours) => {
    summaryAbortRef.current?.abort();
    const ctrl = new AbortController();
    summaryAbortRef.current = ctrl;
    try {
      const res = await fetch(`/api/farm/summary?hours=${hours}`, {
        cache: "no-store",
        signal: ctrl.signal,
      });
      const j = await res.json().catch(() => null);
      if (ctrl.signal.aborted) return;
      if (res.status === 401 || res.redirected) {
        setSummaryError("auth");
      } else if (res.ok && j?.success) {
        setSummary({
          ...j,
          queue: Array.isArray(j.queue) ? j.queue : [],
          recentEvents: Array.isArray(j.recentEvents) ? j.recentEvents : [],
        });
        setSummaryError(null);
      } else {
        setSummaryError("error");
      }
    } catch (e: any) {
      if (e?.name === "AbortError" || ctrl.signal.aborted) return;
      setSummaryError("error");
    }
    if (!ctrl.signal.aborted) setSummaryLoaded(true);
  }, []);

  // Initial load + 10s polling. Abort in-flight fetches when the page unmounts.
  useEffect(() => {
    loadFarm();
    loadSummary(rangeRef.current);
    const t = setInterval(() => {
      loadFarm();
      loadSummary(rangeRef.current);
    }, 10000);
    return () => {
      clearInterval(t);
      farmAbortRef.current?.abort();
      summaryAbortRef.current?.abort();
    };
  }, [loadFarm, loadSummary]);

  // Header clock, from the real clock only.
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // Cmd/Ctrl+K focuses search; Escape drops menus and dropdowns.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        setMenuFor(null);
        setDeviceMenuOpen(false);
        setRangeOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- derived state ------------------------------------------------------

  const healthByDevice = useMemo(() => {
    const m = new Map<string, FarmDeviceHealth>();
    for (const h of health) m.set(h.device_id, h);
    return m;
  }, [health]);

  const artworkById = useMemo(() => {
    const prev = artworkRef.current;
    const next = new Map<string, Artwork>();
    devices.forEach((d, i) => {
      const kept = prev.get(d.id);
      next.set(d.id, kept ?? (i < ARTWORK_SEQUENCE.length ? ARTWORK_SEQUENCE[i] : ARTWORK_GRAPHITE));
    });
    artworkRef.current = next;
    return next;
  }, [devices]);

  const counts = useMemo(() => {
    const c = { online: 0, idle: 0, offline: 0 };
    for (const d of devices) c[bucketOf(healthByDevice.get(d.id))]++;
    return c;
  }, [devices, healthByDevice]);

  const q = search.trim().toLowerCase();
  const visibleDevices = useMemo(
    () =>
      devices.filter((d) => {
        const name = deviceName(d).toLowerCase();
        if (q && !name.includes(q) && !d.id.toLowerCase().includes(q)) return false;
        if (filter === "all") return true;
        return bucketOf(healthByDevice.get(d.id)) === filter;
      }),
    [devices, healthByDevice, q, filter],
  );

  const device = devices.find((d) => d.id === sel) ?? null;
  const deviceHealth = device ? healthByDevice.get(device.id) ?? null : null;
  const deviceArt = device ? artworkById.get(device.id) ?? ARTWORK_GRAPHITE : ARTWORK_GRAPHITE;

  // Keep a valid selection: restore the persisted one, else the first device,
  // and fall back when the selected device disappears.
  useEffect(() => {
    if (!farmLoaded) return;
    if (sel && devices.some((d) => d.id === sel)) return;
    let next: string | null = null;
    try {
      const stored = window.localStorage.getItem("octagon.fleet.selectedDevice");
      if (stored && devices.some((d) => d.id === stored)) next = stored;
    } catch {}
    if (!next) next = devices[0]?.id ?? null;
    if (next !== sel) setSel(next);
  }, [farmLoaded, devices, sel]);

  function selectDevice(id: string) {
    setSel(id);
    try {
      window.localStorage.setItem("octagon.fleet.selectedDevice", id);
    } catch {}
  }

  const hubRunning = Boolean(
    hub && num(hub.active)! > 0 && Date.now() - new Date(hub.ts).getTime() < 20000,
  );
  const hubState: "running" | "down" | "checking" = !farmLoaded
    ? "checking"
    : hubRunning
      ? "running"
      : "down";

  const online = num(summary?.devices?.online);
  const total = num(summary?.devices?.total);
  const swipes = num(summary?.swipes?.count);
  const deltaPct = summary?.swipes?.deltaPct ?? null;
  const activeSessions = num(summary?.sessions?.active);
  const successPct = summary?.successRate?.pct ?? null;
  const successSamples = num(summary?.successRate?.sampleCount) ?? 0;
  const cycleSeconds = summary?.avgCycleTime?.seconds ?? null;
  const cycleSamples = num(summary?.avgCycleTime?.sampleCount) ?? 0;

  const rangeMeta = RANGES.find((r) => r.hours === range) ?? RANGES[1];
  const clockDate = now
    ? now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    : "";
  const clockTime = now
    ? now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "";

  const heading = !summaryLoaded
    ? "Loading fleet..."
    : summaryError
      ? "Fleet status unavailable"
      : online !== null && total !== null
        ? `${online} of ${total} devices online`
        : "Fleet status unavailable";

  const subline = summaryError
    ? summaryError === "auth"
      ? "Sign in to see fleet status."
      : "The summary endpoint could not be reached."
    : !summaryLoaded
      ? "Reading the farm database."
      : total !== null && online !== null
        ? total === 0
          ? "No devices yet."
          : online === total
            ? "Fleet is running smoothly."
            : `Fleet degraded - ${total - online} offline.`
        : "";

  const onlinePct = online !== null && total !== null && total > 0 ? Math.round((online / total) * 100) : 0;

  const queue: SummaryQueueItem[] = summary?.queue ?? [];
  const events: SummaryEvent[] = summary?.recentEvents ?? [];

  function openSession(deviceId?: string) {
    const target = deviceId ?? sel ?? devices[0]?.id ?? "";
    setSessionDeviceId(target);
    setSessionMinutes("");
    setSessionError("");
    setModal("session");
  }

  function openAdd() {
    setAddPrefix("");
    setAddError("");
    setModal("add");
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

  // ---- actions ------------------------------------------------------------

  async function scheduleSession() {
    const n = Number(sessionMinutes);
    if (!Number.isInteger(n) || n < 1 || n > MAX_MINUTES) {
      setSessionError(`Enter a whole number of minutes between 1 and ${MAX_MINUTES}.`);
      return;
    }
    if (!sessionDeviceId) {
      setSessionError("Choose a device first.");
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
          device_id: sessionDeviceId,
          payload: { duration_minutes: n },
        }),
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.success) {
        setModal(null);
        loadSummary(rangeRef.current);
        loadFarm();
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
        if (j.device?.id) selectDevice(j.device.id);
        setModal(null);
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

  async function confirmCancel() {
    if (!cancelTarget) return;
    setCancelError("");
    setCanceling(true);
    try {
      const res = await fetch(`/api/farm/tasks/${encodeURIComponent(cancelTarget.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "canceled" }),
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.success) {
        setCancelTarget(null);
        loadSummary(rangeRef.current);
        loadFarm();
      } else if (res.status === 401 || res.redirected) {
        setCancelError("Sign in required to cancel tasks.");
      } else if (res.status === 403) {
        setCancelError("Canceling tasks requires the admin role.");
      } else {
        setCancelError(String(j?.error || `Could not cancel the task (HTTP ${res.status}).`));
      }
    } catch {
      setCancelError("Could not cancel the task. The farm API is unreachable.");
    }
    setCanceling(false);
  }

  function retry() {
    loadFarm();
    loadSummary(rangeRef.current);
  }

  // ---- render helpers -----------------------------------------------------

  const filterRows: {
    key: "all" | "online" | "idle" | "offline";
    label: string;
    count: number;
    icon?: React.ReactNode;
    dot?: string;
    dotDim?: boolean;
  }[] = [
    {
      key: "all",
      label: "All devices",
      count: devices.length,
      icon: <Database size={15} strokeWidth={1.75} aria-hidden="true" />,
    },
    { key: "online", label: "Online", count: counts.online, dot: "var(--success)" },
    { key: "idle", label: "Idle", count: counts.idle, dot: "var(--text-muted)" },
    { key: "offline", label: "Offline", count: counts.offline, dot: "var(--text-muted)", dotDim: true },
  ];

  const tableGrid = "grid grid-cols-[28px_minmax(0,1fr)_96px_128px_96px_32px] items-center gap-3";

  function queueDeviceLabel(id: string): string {
    const d = devices.find((x) => x.id === id);
    return d ? deviceName(d) : id || "-";
  }

  // ---- render -------------------------------------------------------------

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink">
      <TitleBar
        hub={hubState}
        view="fleet"
        onViewChange={(v) => router.push(v === "fleet" ? "/dashboard" : "/")}
        onOpenSettings={openSettings}
      />

      <div className="flex min-h-0 flex-1">
        {/* ------------------------- left device rail ------------------------- */}
        <aside className="hidden w-[300px] shrink-0 flex-col border-r border-hairline bg-sidebar lg:flex">
          <div className="px-3 pb-2 pt-3">
            <div className="relative">
              <Search
                size={14}
                strokeWidth={1.75}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute"
              />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search devices..."
                aria-label="Search devices"
                className="w-full rounded-control border border-hairline bg-surface py-2 pl-9 pr-12 text-[13px] text-ink placeholder:text-ink-mute focus:outline-none"
              />
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-hairline bg-raised px-1.5 py-0.5 text-[10px] text-ink-mute">
                ⌘K
              </kbd>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
            {!farmLoaded && (
              <p className="px-3 py-4 text-[12.5px] text-ink-mute">Loading devices...</p>
            )}
            {farmError === "auth" && (
              <div className="px-3 py-4 text-[12.5px] leading-relaxed text-ink-dim">
                Sign in required.
                <br />
                <Link href="/login" className="text-ink underline underline-offset-2">
                  Go to login
                </Link>
              </div>
            )}
            {farmError === "error" && (
              <div className="px-3 py-4 text-[12.5px] leading-relaxed text-ink-dim">
                Could not load devices.
                <br />
                <span className="break-words text-ink-mute">{farmErrorMsg}</span>
              </div>
            )}
            {farmLoaded && !farmError && devices.length === 0 && (
              <div className="px-3 py-4 text-[12.5px] leading-relaxed text-ink-dim">
                No devices yet. Add one to get started.
              </div>
            )}
            {visibleDevices.map((d) => {
              const dh = healthByDevice.get(d.id) ?? null;
              const bucket = bucketOf(dh);
              const isSel = d.id === device?.id;
              const art = artworkById.get(d.id) ?? ARTWORK_GRAPHITE;
              const lastSeen = dh?.updated_at || d.updated_at;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => selectDevice(d.id)}
                  aria-current={isSel || undefined}
                  className={`relative w-full rounded-control px-2.5 py-2.5 text-left transition-colors ${
                    isSel ? "bg-selected" : "hover:bg-hover"
                  }`}
                >
                  {isSel && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1/2 h-9 w-[3px] -translate-y-1/2 rounded-full bg-accent"
                    />
                  )}
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <DeviceIdentity
                        name={deviceName(d)}
                        sub={`${(num(dh?.swipes) ?? 0).toLocaleString("en-US")} swipes · ${fmtTime(lastSeen)}`}
                        artwork={art.src}
                        color={art.color}
                        size={40}
                      />
                    </div>
                    <StatusChip state={chipForBucket(bucket)} />
                  </div>
                </button>
              );
            })}
            {farmLoaded && !farmError && devices.length > 0 && visibleDevices.length === 0 && (
              <p className="px-3 py-4 text-[12.5px] text-ink-mute">No device matches.</p>
            )}
          </div>

          <div className="px-3 pb-2">
            <button
              type="button"
              onClick={openAdd}
              className="flex w-full items-center gap-2.5 rounded-control border border-hairline bg-surface px-3 py-2.5 text-[13px] font-medium text-ink-dim transition-colors hover:bg-hover"
            >
              <span
                aria-hidden="true"
                className="grid h-6 w-6 place-items-center rounded-full border border-hairline bg-raised text-ink-dim"
              >
                <Plus size={13} strokeWidth={2} />
              </span>
              Add device
            </button>
          </div>

          <div className="space-y-0.5 px-2 pb-3">
            {filterRows.map((f) => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  aria-pressed={active}
                  className={`flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-left text-[13px] transition-colors ${
                    active ? "bg-selected text-ink" : "text-ink-dim hover:bg-hover"
                  }`}
                >
                  {f.icon ? (
                    <span className="inline-flex text-ink-mute" aria-hidden="true">
                      {f.icon}
                    </span>
                  ) : f.dot ? (
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: f.dot, opacity: f.dotDim ? 0.6 : 1 }}
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">{f.label}</span>
                  <span className="tnum text-xs text-ink-mute">{f.count}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* --------------------------- center column -------------------------- */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[860px] px-6 py-6 md:px-8">
            {/* header */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="tnum text-[12.5px] text-ink-mute">
                  {clockDate || "\u00a0"}
                  {clockTime && <span className="ml-3">{clockTime}</span>}
                </div>
                <h1 className="mt-1.5 text-[30px] font-semibold leading-tight tracking-tight text-ink">
                  {heading}
                </h1>
                {subline && <p className="mt-1 text-[14px] text-ink-dim">{subline}</p>}
              </div>

              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setRangeOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={rangeOpen}
                  className="flex items-center gap-2 rounded-control border border-hairline bg-surface px-3.5 py-2 text-[13px] text-ink-dim transition-colors hover:bg-hover"
                >
                  {rangeMeta.label}
                  <ChevronDown
                    size={14}
                    strokeWidth={1.75}
                    aria-hidden="true"
                    className={`transition-transform ${rangeOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {rangeOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setRangeOpen(false)} />
                    <div
                      role="listbox"
                      aria-label="Time range"
                      className="absolute right-0 z-40 mt-1.5 w-44 overflow-hidden rounded-control border border-hairline bg-surface shadow-xl"
                    >
                      {RANGES.map((r) => (
                        <button
                          key={r.hours}
                          type="button"
                          role="option"
                          aria-selected={r.hours === range}
                          onClick={() => {
                            setRangeOpen(false);
                            if (r.hours !== range) {
                              setRange(r.hours);
                              loadSummary(r.hours);
                            }
                          }}
                          className={`block w-full px-3 py-2 text-left text-[13px] transition-colors hover:bg-hover ${
                            r.hours === range ? "font-medium text-ink" : "text-ink-dim"
                          }`}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* summary error / auth banners */}
            {summaryError === "error" && (
              <div
                role="alert"
                className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-card border border-hairline bg-surface px-4 py-3"
              >
                <p className="text-[13px] text-ink-dim">
                  Could not load fleet metrics. The summary endpoint did not respond.
                </p>
                <button
                  type="button"
                  onClick={retry}
                  className="rounded-control border border-hairline bg-raised px-3 py-1.5 text-[12.5px] font-medium text-ink-dim transition-colors hover:bg-hover"
                >
                  Try again
                </button>
              </div>
            )}

            {/* metric row 1 */}
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
              <MetricCard
                icon={<Smartphone size={18} strokeWidth={1.75} />}
                label="Devices online"
                value={
                  online !== null && total !== null ? `${online} / ${total}` : "\u2014"
                }
                sub={
                  online !== null && total !== null
                    ? `${onlinePct}% online`
                    : "Not enough data yet"
                }
                footer={
                  online !== null && total !== null && total > 0 ? (
                    <div
                      className="h-1.5 w-full overflow-hidden rounded-full bg-raised"
                      role="progressbar"
                      aria-valuenow={onlinePct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="Share of devices online"
                    >
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${onlinePct}%` }}
                      />
                    </div>
                  ) : undefined
                }
              />
              <MetricCard
                icon={<Play size={18} strokeWidth={1.75} />}
                label="Active sessions"
                value={activeSessions !== null ? String(activeSessions) : "\u2014"}
                sub={
                  activeSessions !== null && total !== null
                    ? `of ${total} devices`
                    : "Not enough data yet"
                }
              />
              <MetricCard
                icon={<Activity size={18} strokeWidth={1.75} />}
                label={`Swipes (${rangeMeta.short})`}
                value={swipes !== null ? swipes.toLocaleString("en-US") : "\u2014"}
                sub={swipes === null ? "Not enough data yet" : undefined}
                footer={deltaPct !== null ? <DeltaChip pct={deltaPct} /> : undefined}
              />
            </div>

            {/* metric row 2 */}
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <MetricCard
                icon={<CircleCheck size={18} strokeWidth={1.75} />}
                label="Session success rate"
                value={successPct !== null ? `${successPct}%` : "\u2014"}
                sub={
                  successPct !== null
                    ? `${successSamples.toLocaleString("en-US")} sessions sampled`
                    : "Not enough data yet"
                }
              />
              <MetricCard
                icon={<Clock size={18} strokeWidth={1.75} />}
                label="Avg cycle time"
                value={cycleSeconds !== null ? fmtCycle(cycleSeconds) : "\u2014"}
                sub={
                  cycleSeconds !== null
                    ? `${cycleSamples.toLocaleString("en-US")} runs sampled`
                    : "Not enough data yet"
                }
              />
            </div>

            {/* tabs */}
            <div className="mt-8 flex items-end justify-between border-b border-hairline">
              <div className="flex gap-6">
                {(
                  [
                    { key: "queue", label: "Activity queue" },
                    { key: "events", label: "Recent events" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    aria-pressed={tab === t.key}
                    className={`-mb-px border-b-2 pb-2.5 text-[13.5px] transition-colors ${
                      tab === t.key
                        ? "border-accent font-medium text-ink"
                        : "border-transparent text-ink-mute hover:text-ink-dim"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => openSession()}
                className="mb-1.5 flex items-center gap-1.5 rounded-control border border-hairline bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-dim transition-colors hover:bg-hover"
              >
                <Plus size={14} strokeWidth={2} aria-hidden="true" />
                New session
              </button>
            </div>

            {/* tab content */}
            {tab === "queue" ? (
              <div className="mt-1">
                {!summaryLoaded && summaryError === null && (
                  <p className="py-6 text-[13px] text-ink-mute">Loading activity...</p>
                )}
                {summaryLoaded && queue.length === 0 && (
                  <p className="py-6 text-[13px] text-ink-mute">
                    No queued sessions. Schedule one with New session.
                  </p>
                )}
                {queue.map((t, i) => {
                  const cancellable = t.status === "scheduled" || t.status === "running";
                  return (
                    <div
                      key={t.id}
                      className={`${tableGrid} border-b border-hairline py-3 last:border-b-0`}
                    >
                      <span className="tnum text-[13px] text-ink-mute">{i + 1}</span>
                      <span className="truncate text-[13.5px] font-medium text-ink">
                        {t.title || "Session"}
                      </span>
                      <span className="truncate text-[13px] text-ink-dim">
                        {queueDeviceLabel(t.device)}
                      </span>
                      <span>
                        <StatusChip state={taskChipState(t.status)} />
                      </span>
                      <span className="tnum truncate text-[12.5px] text-ink-mute">
                        {fmtTime(t.createdAt)}
                      </span>
                      <span className="relative text-right">
                        <button
                          type="button"
                          aria-label={`Actions for ${t.title || "session"}`}
                          aria-expanded={menuFor === t.id}
                          onClick={() => setMenuFor(menuFor === t.id ? null : t.id)}
                          className="rounded-md p-1.5 text-ink-mute transition-colors hover:bg-hover hover:text-ink-dim"
                        >
                          <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                        {menuFor === t.id && (
                          <>
                            <div className="fixed inset-0 z-30" onClick={() => setMenuFor(null)} />
                            <div className="absolute right-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-control border border-hairline bg-surface shadow-xl">
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuFor(null);
                                  router.push("/");
                                }}
                                className="block w-full px-3 py-2 text-left text-[13px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
                              >
                                Open conversation
                              </button>
                              {cancellable && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMenuFor(null);
                                    setCancelError("");
                                    setCancelTarget(t);
                                  }}
                                  className="block w-full px-3 py-2 text-left text-[13px] text-danger transition-colors hover:bg-hover"
                                >
                                  Cancel task
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-5 space-y-4 pb-2">
                {!summaryLoaded && summaryError === null && (
                  <p className="text-[13px] text-ink-mute">Loading events...</p>
                )}
                {summaryLoaded && events.length === 0 && (
                  <p className="text-[13px] text-ink-mute">No events yet.</p>
                )}
                {events.map((e) => (
                  <EventMessage
                    key={e.id}
                    icon={<Activity size={16} strokeWidth={1.75} />}
                    text={String(e.text ?? "")}
                    ts={fmtTime(e.ts)}
                    side="agent"
                    iconTone={/error|fail/i.test(String(e.text ?? "")) ? "error" : "default"}
                  />
                ))}
              </div>
            )}
          </div>
        </main>

        {/* ------------------------- right inspector -------------------------- */}
        <aside className="hidden w-[350px] shrink-0 overflow-y-auto border-l border-hairline bg-sidebar xl:block">
          <div className="px-5 py-5">
            {!farmLoaded && <p className="text-[13px] text-ink-mute">Loading device...</p>}
            {farmLoaded && !device && (
              <div className="grid h-full place-items-center py-16 text-center">
                <div>
                  <p className="text-[13px] font-medium text-ink-dim">No device selected</p>
                  <p className="mt-1 text-[12px] text-ink-mute">
                    Add a device to see its details here.
                  </p>
                </div>
              </div>
            )}
            {device && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <DeviceIdentity
                      name={deviceName(device)}
                      sub={device.id}
                      artwork={deviceArt.src}
                      color={deviceArt.color}
                      size={44}
                    />
                  </div>
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      aria-label={`Actions for ${deviceName(device)}`}
                      aria-expanded={deviceMenuOpen}
                      onClick={() => setDeviceMenuOpen((v) => !v)}
                      className="rounded-md p-1.5 text-ink-mute transition-colors hover:bg-hover hover:text-ink-dim"
                    >
                      <MoreHorizontal size={18} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                    {deviceMenuOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-30"
                          onClick={() => setDeviceMenuOpen(false)}
                        />
                        <div className="absolute right-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-control border border-hairline bg-surface shadow-xl">
                          <button
                            type="button"
                            onClick={() => {
                              setDeviceMenuOpen(false);
                              router.push("/");
                            }}
                            className="block w-full px-3 py-2 text-left text-[13px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
                          >
                            Open conversation
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-5">
                  <PhonePreview
                    artwork={deviceArt.src}
                    state="unavailable"
                    note="Live screen capture requires libimobiledevice and the device UDID (see setup guide)."
                  />
                </div>

                <h2 className="mb-2 mt-6 text-[15px] font-semibold text-ink">Device details</h2>
                <SectionCard className="divide-y divide-hairline">
                  <DetailRow
                    icon={<Activity size={15} strokeWidth={1.75} />}
                    label="State"
                    value={deviceHealth?.session_state || "idle"}
                  />
                  <DetailRow
                    icon={<Battery size={15} strokeWidth={1.75} />}
                    label="Battery"
                    value={
                      <>
                        {"\u2014"}{" "}
                        <span className="text-[11px] font-normal text-ink-mute">unavailable</span>
                      </>
                    }
                    tone="muted"
                    title="The runtime does not provide battery level."
                  />
                  <DetailRow
                    icon={<Thermometer size={15} strokeWidth={1.75} />}
                    label="Temperature"
                    value={
                      <>
                        {"\u2014"}{" "}
                        <span className="text-[11px] font-normal text-ink-mute">unavailable</span>
                      </>
                    }
                    tone="muted"
                    title="The runtime does not provide temperature."
                  />
                  <DetailRow
                    icon={<Usb size={15} strokeWidth={1.75} />}
                    label="USB connected"
                    value={deviceHealth?.usb_connected ? "Yes" : "No"}
                  />
                  <DetailRow
                    icon={<Clock size={15} strokeWidth={1.75} />}
                    label="Last action"
                    value={
                      deviceHealth?.last_action
                        ? `${deviceHealth.last_action}, ${fmtTime(deviceHealth.last_action_at)}`
                        : "none"
                    }
                  />
                  <DetailRow
                    icon={<HeartPulse size={15} strokeWidth={1.75} />}
                    label="Health"
                    value={deviceHealth?.error ? "Error" : "Good"}
                    tone={deviceHealth?.error ? "error" : "success"}
                    title={deviceHealth?.error || undefined}
                  />
                </SectionCard>

                <h2 className="mb-2 mt-6 text-[15px] font-semibold text-ink">Quick actions</h2>
                <div className="grid grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => openSession(device.id)}
                    className="flex flex-col items-center justify-center gap-1.5 rounded-control bg-accent px-1 py-3 text-[11.5px] font-medium text-white transition-colors hover:bg-accent-hover"
                  >
                    <Play size={16} strokeWidth={1.75} aria-hidden="true" />
                    Run
                  </button>
                  <button
                    type="button"
                    disabled
                    title="Pause is not supported yet"
                    aria-label="Pause (not supported yet)"
                    className="flex cursor-not-allowed flex-col items-center justify-center gap-1.5 rounded-control border border-hairline bg-surface px-1 py-3 text-[11.5px] font-medium text-ink-dim opacity-45"
                  >
                    <Pause size={16} strokeWidth={1.75} aria-hidden="true" />
                    Pause
                  </button>
                  <button
                    type="button"
                    disabled
                    title="Reconnect is not supported yet"
                    aria-label="Reconnect (not supported yet)"
                    className="flex cursor-not-allowed flex-col items-center justify-center gap-1.5 rounded-control border border-hairline bg-surface px-1 py-3 text-[11.5px] font-medium text-ink-dim opacity-45"
                  >
                    <RotateCw size={16} strokeWidth={1.75} aria-hidden="true" />
                    Reconnect
                  </button>
                  <button
                    type="button"
                    disabled
                    title="Screen capture not set up - see the setup guide"
                    aria-label="Open screen (not set up)"
                    className="flex cursor-not-allowed flex-col items-center justify-center gap-1.5 rounded-control border border-hairline bg-surface px-1 py-3 text-[11.5px] font-medium text-ink-dim opacity-45"
                  >
                    <MonitorSmartphone size={16} strokeWidth={1.75} aria-hidden="true" />
                    <span className="w-full truncate text-center">Open screen</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      {/* ------------------------------ modals ------------------------------ */}

      {modal === "session" && (
        <Modal title="New session" onClose={() => setModal(null)} maxWidth={380}>
          <div className="space-y-4 p-4">
            <div>
              <label htmlFor="session-device" className="mb-1.5 block text-[12px] text-ink-mute">
                Device
              </label>
              <select
                id="session-device"
                value={sessionDeviceId}
                onChange={(e) => setSessionDeviceId(e.target.value)}
                className="w-full rounded-control border border-hairline bg-surface px-3 py-2 text-[13px] text-ink focus:outline-none"
              >
                {devices.length === 0 && <option value="">No devices yet</option>}
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {deviceName(d)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="mb-1.5 block text-[12px] text-ink-mute">Duration (minutes)</span>
              <div className="flex flex-wrap gap-2">
                {SESSION_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setSessionMinutes(String(n))}
                    aria-pressed={sessionMinutes === String(n)}
                    className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                      sessionMinutes === String(n)
                        ? "border-accent bg-accent-soft font-medium text-ink"
                        : "border-hairline bg-raised text-ink-dim hover:bg-hover"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={MAX_MINUTES}
                  value={sessionMinutes}
                  onChange={(e) => setSessionMinutes(e.target.value)}
                  placeholder="Custom"
                  aria-label="Custom duration in minutes"
                  className="w-full rounded-control border border-hairline bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-mute focus:outline-none"
                />
                <span className="shrink-0 text-[12px] text-ink-mute">min</span>
              </div>
            </div>
            <p className="text-[11.5px] leading-relaxed text-ink-mute">
              The session runs when the hub picks it up. In dry-run mode nothing is spoken aloud.
            </p>
            {sessionError && (
              <p role="alert" className="text-[12px] text-danger">
                {sessionError}
              </p>
            )}
            <button
              type="button"
              onClick={scheduleSession}
              disabled={sessionPosting || devices.length === 0}
              className="w-full rounded-control bg-accent py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sessionPosting ? "Scheduling" : "Schedule session"}
            </button>
          </div>
        </Modal>
      )}

      {modal === "add" && (
        <Modal title="Add device" onClose={() => setModal(null)} maxWidth={360}>
          <div className="space-y-3 p-4">
            <label htmlFor="prefix" className="block text-[12px] text-ink-mute">
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
              className="w-full rounded-control border border-hairline bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-mute focus:outline-none"
            />
            <p className="text-[11.5px] leading-relaxed text-ink-mute">
              {`On the iPhone, create a Voice Control custom command named "${
                addPrefix.trim() || "Alpha"
              } Swipe Next" that performs a swipe-up.`}
            </p>
            {addError && (
              <p role="alert" className="text-[12px] text-danger">
                {addError}
              </p>
            )}
            <button
              type="button"
              onClick={addDevice}
              disabled={adding || addPrefix.trim().length < 2}
              className="w-full rounded-control bg-accent py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {adding ? "Adding" : "Add device"}
            </button>
          </div>
        </Modal>
      )}

      {modal === "settings" && (
        <Modal title="Settings" onClose={() => setModal(null)}>
          <div className="p-4 text-[13px]">
            {settingsLoading && <p className="py-2 text-ink-mute">Checking</p>}
            {!settingsLoading && settings && (
              <div className="divide-y divide-hairline">
                <div className="flex items-center justify-between py-2">
                  <span className="text-ink-mute">Status</span>
                  <span
                    className="font-medium"
                    style={{
                      color:
                        settings.status === "healthy"
                          ? "var(--success)"
                          : settings.status === "degraded"
                            ? "var(--warning)"
                            : "var(--error)",
                    }}
                  >
                    {settings.status}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-ink-mute">Database</span>
                  <span className="min-w-0 break-words text-right">{`SQLite, local: ${settings.database}`}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-ink-mute">Devices</span>
                  <span className="tnum">{devices.length}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-ink-mute">Cloud</span>
                  <span>None - everything stays on this Mac</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-ink-mute">Checked at</span>
                  <span className="tnum">
                    {settings.timestamp
                      ? new Date(settings.timestamp).toLocaleString("en-US")
                      : "-"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {cancelTarget && (
        <Modal
          title="Cancel task"
          onClose={() => {
            setCancelTarget(null);
            setCancelError("");
          }}
          maxWidth={380}
        >
          <div className="p-4">
            <p className="text-[13px] leading-relaxed text-ink-dim">
              {`Cancel "${cancelTarget.title || "this session"}" on ${queueDeviceLabel(
                cancelTarget.device,
              )}? The hub will not run this task.`}
            </p>
            {cancelError && (
              <p role="alert" className="mt-2 text-[12px] text-danger">
                {cancelError}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setCancelTarget(null);
                  setCancelError("");
                }}
                className="flex-1 rounded-control border border-hairline bg-surface py-2 text-[13px] font-medium text-ink-dim transition-colors hover:bg-hover"
              >
                Keep task
              </button>
              <button
                type="button"
                onClick={confirmCancel}
                disabled={canceling}
                className="flex-1 rounded-control bg-danger py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {canceling ? "Canceling" : "Cancel task"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
