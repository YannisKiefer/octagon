"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format, isSameDay, startOfDay } from "date-fns";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import type { FarmDevice, FarmDeviceHealth, FarmTask, FarmTaskStatus, FarmTaskType } from "@/lib/farmTypes";

const PX_PER_MINUTE = 1; // 60px per hour

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function roundToMinutes(minutes: number, step: number) {
  return Math.round(minutes / step) * step;
}

function minutesSinceMidnight(d: Date) {
  return d.getHours() * 60 + d.getMinutes();
}

function dayKey(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function taskColor(type: FarmTaskType, status: FarmTaskStatus) {
  if (status === "failed") return { bg: "rgba(239,68,68,0.18)", border: "rgba(239,68,68,0.35)", text: "#FCA5A5" };
  if (status === "running") return { bg: "rgba(59,130,246,0.18)", border: "rgba(59,130,246,0.35)", text: "#BFDBFE" };
  if (status === "succeeded") return { bg: "rgba(34,197,94,0.16)", border: "rgba(34,197,94,0.30)", text: "#86EFAC" };
  if (type === "warmup") return { bg: "rgba(59,130,246,0.14)", border: "rgba(59,130,246,0.26)", text: "#BFDBFE" };
  if (type === "audit") return { bg: "rgba(139,92,246,0.14)", border: "rgba(139,92,246,0.26)", text: "#DDD6FE" };
  return { bg: "rgba(34,197,94,0.14)", border: "rgba(34,197,94,0.26)", text: "#BBF7D0" };
}

function formatTime(d: Date) {
  return format(d, "HH:mm");
}

function parsePayload(payload: string): any {
  try {
    return JSON.parse(payload || "{}");
  } catch {
    return {};
  }
}

function estimateDurationMinutes(task: FarmTask) {
  const payload = parsePayload(task.payload);
  const raw = payload.durationMinutes || payload.duration || payload.minutes;
  const n = raw ? Number(raw) : null;
  if (task.type === "warmup") return clamp(Number.isFinite(n) && n ? n : 60, 5, 240);
  if (task.type === "post") return clamp(Number.isFinite(n) && n ? n : 15, 5, 120);
  return clamp(Number.isFinite(n) && n ? n : 10, 5, 120);
}

type CreateModalState =
  | { open: false }
  | {
      open: true;
      type: FarmTaskType;
      deviceId: string | "global";
      scheduledFor: string; // ISO
      durationMinutes?: number;
    };

export default function CalendarPage() {
  const [date, setDate] = useState<Date>(() => new Date());
  const [devices, setDevices] = useState<FarmDevice[]>([]);
  const [health, setHealth] = useState<Record<string, FarmDeviceHealth>>({});
  const [tasks, setTasks] = useState<FarmTask[]>([]);
  const [loading, setLoading] = useState(true);

  const [menuOpen, setMenuOpen] = useState(false);
  const [createState, setCreateState] = useState<CreateModalState>({ open: false });

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const selectedDay = useMemo(() => startOfDay(date), [date]);
  const selectedDayIso = useMemo(() => dayKey(selectedDay), [selectedDay]);

  const globalTasks = useMemo(() => tasks.filter((t) => !t.device_id), [tasks]);
  const deviceTasks = useMemo(() => tasks.filter((t) => t.device_id), [tasks]);

  const nowLineTop = useMemo(() => {
    if (!isSameDay(new Date(), selectedDay)) return null;
    return minutesSinceMidnight(new Date()) * PX_PER_MINUTE;
  }, [selectedDay]);

  useEffect(() => {
    const tick = async () => {
      try {
        const [dRes, tRes] = await Promise.all([
          fetch("/api/farm/devices", { cache: "no-store" }),
          fetch(`/api/farm/tasks?date=${encodeURIComponent(selectedDayIso)}`, { cache: "no-store" }),
        ]);
        const dJson = await dRes.json();
        const tJson = await tRes.json();
        if (dJson?.success) {
          setDevices(dJson.devices || []);
          const by: Record<string, FarmDeviceHealth> = {};
          for (const h of dJson.health || []) by[h.device_id] = h;
          setHealth(by);
        }
        if (tJson?.success) {
          setTasks(tJson.tasks || []);
        }
      } finally {
        setLoading(false);
      }
    };

    tick();
    const id = setInterval(tick, 4000);
    return () => clearInterval(id);
  }, [selectedDayIso]);

  useEffect(() => {
    // Auto-scroll to current time on first load.
    if (!scrollRef.current) return;
    if (loading) return;
    const top = (minutesSinceMidnight(new Date()) - 60) * PX_PER_MINUTE;
    scrollRef.current.scrollTop = clamp(top, 0, 24 * 60 * PX_PER_MINUTE);
  }, [loading]);

  const openCreate = (type: FarmTaskType) => {
    const base = new Date();
    base.setSeconds(0, 0);
    base.setMinutes(roundToMinutes(base.getMinutes() + 5, 5));

    setCreateState({
      open: true,
      type,
      deviceId: type === "post" ? "global" : devices[0]?.id || "global",
      scheduledFor: base.toISOString(),
      durationMinutes: type === "warmup" ? 60 : type === "post" ? 15 : 10,
    });
    setMenuOpen(false);
  };

  const submitCreate = async () => {
    if (!createState.open) return;
    const body: any = {
      type: createState.type,
      device_id: createState.deviceId === "global" ? null : createState.deviceId,
      scheduled_for: createState.scheduledFor,
      payload:
        createState.type === "warmup"
          ? { durationMinutes: createState.durationMinutes }
          : createState.type === "post"
            ? { durationMinutes: createState.durationMinutes }
            : { durationMinutes: createState.durationMinutes },
    };

    const res = await fetch("/api/farm/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json?.success) {
      alert(json?.error || "Failed to create task");
      return;
    }
    setCreateState({ open: false });
  };

  const patchTask = async (taskId: string, patch: Partial<Pick<FarmTask, "scheduled_for" | "device_id" | "status">>) => {
    const res = await fetch(`/api/farm/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!json?.success) {
      alert(json?.error || "Failed to update task");
    }
  };

  const onDropToDeviceColumn = async (e: React.DragEvent, deviceId: string) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const taskId = String(data.taskId || "");
    if (!taskId) return;

    const col = e.currentTarget as HTMLDivElement;
    const rect = col.getBoundingClientRect();
    const y = e.clientY - rect.top + col.scrollTop;
    const minutes = clamp(roundToMinutes(y / PX_PER_MINUTE, 5), 0, 24 * 60 - 1);

    const d = new Date(selectedDay);
    d.setHours(0, 0, 0, 0);
    d.setMinutes(minutes);
    const scheduledFor = d.toISOString();

    // Optimistic UI
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, device_id: deviceId, scheduled_for: scheduledFor, status: "scheduled" } : t)),
    );

    await patchTask(taskId, { device_id: deviceId, scheduled_for: scheduledFor, status: "scheduled" });
  };

  const renderHourLabels = () => (
    <div style={{ height: 24 * 60 * PX_PER_MINUTE, position: "relative" }}>
      {Array.from({ length: 24 }).map((_, h) => (
        <div
          key={h}
          style={{
            position: "absolute",
            top: h * 60 * PX_PER_MINUTE - 7,
            right: 10,
            fontSize: 11,
            color: "var(--text-tertiary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {String(h).padStart(2, "0")}:00
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ maxWidth: 1300, margin: "0 auto" }}>
      <div style={{ padding: "28px 0 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 650, letterSpacing: "-0.02em" }}>Master Calendar</div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 6 }}>
            Schedule Farm tasks (Warmup / Audit / Post) — drag to reschedule
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            className="btn-ghost"
            onClick={() => setDate((d) => addDays(d, -1))}
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <ChevronLeft size={16} /> Prev
          </button>
          <button className="btn-ghost" onClick={() => setDate(new Date())}>
            Today
          </button>
          <button
            className="btn-ghost"
            onClick={() => setDate((d) => addDays(d, 1))}
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            Next <ChevronRight size={16} />
          </button>

          <div style={{ width: 1, height: 28, background: "var(--border-subtle)" }} />

          <div style={{ position: "relative" }}>
            <button
              className="btn-primary"
              onClick={() => setMenuOpen((v) => !v)}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <Plus size={16} /> New
            </button>
            {menuOpen && (
              <div
                style={{
                  position: "absolute",
                  top: 44,
                  right: 0,
                  width: 220,
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-default)",
                  borderRadius: 12,
                  boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
                  padding: 8,
                  zIndex: 50,
                }}
              >
                {([
                  { type: "warmup", label: "Warmup Task", sub: "Voice Control session" },
                  { type: "audit", label: "Audit Task", sub: "USB + screenshot" },
                  { type: "post", label: "Post Task", sub: "Run posting pipeline" },
                ] as Array<{ type: FarmTaskType; label: string; sub: string }>).map((it) => (
                  <button
                    key={it.type}
                    onClick={() => openCreate(it.type)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 10px",
                      borderRadius: 10,
                      border: "1px solid transparent",
                      background: "transparent",
                      cursor: "pointer",
                      color: "var(--text-primary)",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <div style={{ fontSize: 13, fontWeight: 650 }}>{it.label}</div>
                    <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>{it.sub}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ paddingBottom: 14, color: "var(--text-secondary)", fontSize: 13, fontWeight: 600 }}>
        {format(selectedDay, "EEEE, MMM d, yyyy")}
      </div>

      {/* Global tasks */}
      {globalTasks.length > 0 && (
        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Global Tasks
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
            {globalTasks.map((t) => {
              const start = new Date(t.scheduled_for);
              const c = taskColor(t.type, t.status);
              return (
                <div
                  key={t.id}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 12,
                    background: c.bg,
                    border: `1px solid ${c.border}`,
                    color: c.text,
                    fontSize: 12,
                    fontWeight: 650,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span style={{ textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 11 }}>{t.type}</span>
                  <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{formatTime(start)}</span>
                  <span style={{ color: "var(--text-tertiary)", fontWeight: 600 }}>{t.status}</span>
                  {t.status !== "scheduled" && (
                    <button
                      className="btn-ghost"
                      style={{ padding: "4px 8px", fontSize: 11 }}
                      onClick={() => patchTask(t.id, { status: "scheduled" })}
                    >
                      Retry
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div
        className="card"
        style={{
          padding: 0,
          overflow: "hidden",
          borderRadius: 16,
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-secondary)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `80px repeat(${Math.max(1, devices.length)}, 1fr)`,
            borderBottom: "1px solid var(--border-subtle)",
            background: "var(--bg-card)",
          }}
        >
          <div style={{ padding: "12px 10px", fontSize: 11, color: "var(--text-tertiary)" }}>Time</div>
          {devices.map((d) => {
            const h = health[d.id];
            const connected = h?.usb_connected ? true : false;
            const dot = connected ? "var(--accent-green)" : "rgba(255,255,255,0.18)";
            return (
              <div key={d.id} style={{ padding: "12px 12px", borderLeft: "1px solid var(--border-subtle)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {d.display_name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 3 }}>
                      Prefix: <span style={{ fontFamily: "monospace" }}>{d.voice_prefix}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 99, background: dot, boxShadow: connected ? `0 0 10px ${dot}` : "none" }} />
                      <span style={{ fontSize: 11, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        {h?.session_state || (connected ? "idle" : "offline")}
                      </span>
                    </div>
                    {h?.last_action && (
                      <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                        Last: <span style={{ color: "var(--text-secondary)", fontWeight: 650 }}>{h.last_action}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {devices.length === 0 && (
            <div style={{ padding: 12, color: "var(--text-tertiary)" }}>
              No devices. Seed `farm_devices` by running `python run.py setup` or `node farm/farm-brain.js`.
            </div>
          )}
        </div>

        <div
          ref={scrollRef}
          style={{
            height: 700,
            overflow: "auto",
            position: "relative",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: `80px repeat(${Math.max(1, devices.length)}, 1fr)` }}>
            <div style={{ position: "relative", borderRight: "1px solid var(--border-subtle)", background: "var(--bg-card)" }}>
              {renderHourLabels()}
            </div>

            {devices.map((d) => {
              const tasksForDevice = deviceTasks.filter((t) => t.device_id === d.id);
              return (
                <div
                  key={d.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onDropToDeviceColumn(e, d.id)}
                  style={{
                    position: "relative",
                    height: 24 * 60 * PX_PER_MINUTE,
                    borderLeft: "1px solid var(--border-subtle)",
                    background:
                      "repeating-linear-gradient(to bottom, rgba(255,255,255,0.02), rgba(255,255,255,0.02) 59px, rgba(255,255,255,0.05) 60px)",
                  }}
                >
                  {nowLineTop !== null && (
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: nowLineTop,
                        height: 2,
                        background: "#EF4444",
                        opacity: 0.85,
                        zIndex: 10,
                      }}
                    />
                  )}
                  {tasksForDevice.map((t) => {
                    const start = new Date(t.scheduled_for);
                    const top = minutesSinceMidnight(start) * PX_PER_MINUTE;
                    const durMin = estimateDurationMinutes(t);
                    const height = Math.max(18, durMin * PX_PER_MINUTE);
                    const c = taskColor(t.type, t.status);
                    return (
                      <div
                        key={t.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/json", JSON.stringify({ taskId: t.id }));
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onClick={() => {
                          const next = t.status === "scheduled" ? "canceled" : "scheduled";
                          const ok = window.confirm(
                            t.status === "scheduled" ? "Cancel this task?" : "Re-schedule this task?",
                          );
                          if (!ok) return;
                          patchTask(t.id, { status: next });
                          setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: next } : x)));
                        }}
                        style={{
                          position: "absolute",
                          left: 10,
                          right: 10,
                          top,
                          height,
                          borderRadius: 14,
                          background: c.bg,
                          border: `1px solid ${c.border}`,
                          color: c.text,
                          padding: "8px 10px",
                          boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
                          cursor: "grab",
                          userSelect: "none",
                          overflow: "hidden",
                        }}
                        title="Drag to reschedule. Click to toggle cancel/restore."
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 800 }}>
                            {t.type}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 700 }}>
                            {formatTime(start)}
                          </div>
                        </div>
                        <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>
                          {t.type === "warmup" ? `${durMin}m session` : t.type === "audit" ? `${durMin}m audit` : `${durMin}m post`}
                        </div>
                        <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-tertiary)" }}>{t.status}</div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Create modal */}
      {createState.open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => setCreateState({ open: false })}
        >
          <div
            className="card"
            style={{ width: 520, maxWidth: "100%", borderRadius: 16, position: "relative" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="btn-ghost"
              style={{ position: "absolute", top: 16, right: 16, padding: 8 }}
              onClick={() => setCreateState({ open: false })}
            >
              <X size={16} />
            </button>

            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.02em" }}>
              New {createState.type.toUpperCase()} task
            </div>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 6 }}>
              Writes to SQLite `farm_tasks`. Farm Brain daemon will execute when due.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 18 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 11, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Device
                </span>
                <select
                  value={createState.deviceId}
                  onChange={(e) =>
                    setCreateState((s) => (s.open ? { ...s, deviceId: e.target.value as any } : s))
                  }
                  style={{
                    background: "var(--bg-input)",
                    border: "1px solid var(--border-default)",
                    borderRadius: 12,
                    padding: "10px 12px",
                    color: "var(--text-primary)",
                  }}
                  disabled={createState.type === "post"}
                >
                  {createState.type === "post" && <option value="global">Global</option>}
                  {createState.type !== "post" && (
                    <>
                      <option value="global">Global</option>
                      {devices.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.display_name}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 11, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Start (ISO)
                </span>
                <input
                  value={createState.scheduledFor}
                  onChange={(e) =>
                    setCreateState((s) => (s.open ? { ...s, scheduledFor: e.target.value } : s))
                  }
                  style={{
                    background: "var(--bg-input)",
                    border: "1px solid var(--border-default)",
                    borderRadius: 12,
                    padding: "10px 12px",
                    color: "var(--text-primary)",
                    fontFamily: "monospace",
                    fontSize: 12,
                  }}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 11, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Duration (minutes)
                </span>
                <input
                  type="number"
                  value={createState.durationMinutes || 10}
                  onChange={(e) =>
                    setCreateState((s) =>
                      s.open ? { ...s, durationMinutes: Number(e.target.value) } : s,
                    )
                  }
                  style={{
                    background: "var(--bg-input)",
                    border: "1px solid var(--border-default)",
                    borderRadius: 12,
                    padding: "10px 12px",
                    color: "var(--text-primary)",
                  }}
                />
              </label>

              <div />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
              <button className="btn-ghost" onClick={() => setCreateState({ open: false })}>
                Cancel
              </button>
              <button className="btn-primary" onClick={submitCreate}>
                Create Task
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

