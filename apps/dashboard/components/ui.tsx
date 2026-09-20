"use client";

import React from "react";
import {
  ArrowUp,
  LayoutDashboard,
  MessageSquare,
  Plus,
  Settings,
  UserRound,
} from "lucide-react";

/* Shared icon well: circular raised surface behind an icon. */
function IconWell({
  children,
  size = 36,
}: {
  children: React.ReactNode;
  size?: number;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-raised text-ink-dim"
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  );
}

/* 52px macOS title bar replacement. The whole bar drags; controls opt out
   with .titlebar-nodrag (both classes defined in app/globals.css). */
export function TitleBar({
  hub,
  view,
  onViewChange,
  onOpenSettings,
}: {
  hub: "running" | "down" | "checking";
  view: "fleet" | "conversation";
  onViewChange: (v: "fleet" | "conversation") => void;
  onOpenSettings: () => void;
}) {
  const hubLabel =
    hub === "running" ? "Hub running" : hub === "down" ? "Hub not running" : "Checking hub";
  const hubLive = hub === "running";

  const viewButton = (target: "fleet" | "conversation", label: string, Icon: typeof LayoutDashboard) => {
    const active = view === target;
    return (
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        title={label}
        onClick={() => onViewChange(target)}
        className={`titlebar-nodrag rounded-[10px] p-2 transition-colors ${
          active
            ? "bg-accent-soft text-accent"
            : "text-ink-mute hover:bg-raised hover:text-ink-dim"
        }`}
      >
        <Icon size={18} strokeWidth={1.75} />
      </button>
    );
  };

  return (
    <header className="titlebar-drag relative z-20 flex h-[52px] shrink-0 items-center justify-between border-b border-hairline bg-sidebar px-4">
      <div className="flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/glyph-white.png" alt="" width={18} height={18} draggable={false} />
        <span className="text-[15px] font-semibold text-ink">Octagon</span>
      </div>

      <div className="titlebar-nodrag absolute left-1/2 flex -translate-x-1/2 items-center gap-1">
        {viewButton("fleet", "Fleet view", LayoutDashboard)}
        {viewButton("conversation", "Conversation view", MessageSquare)}
      </div>

      <div className="titlebar-nodrag flex items-center gap-3">
        <span className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${hubLive ? "bg-success" : "bg-ink-mute"}`}
            aria-hidden="true"
          />
          <span className={`text-[13px] ${hubLive ? "text-ink-dim" : "text-ink-mute"}`}>
            {hubLabel}
          </span>
        </span>
        <span className="h-5 w-px bg-hairline" aria-hidden="true" />
        <button
          type="button"
          aria-label="Open settings"
          title="Settings"
          onClick={onOpenSettings}
          className="rounded-[10px] p-2 text-ink-mute transition-colors hover:bg-raised hover:text-ink-dim"
        >
          <Settings size={18} strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}

const STATUS_META: Record<
  string,
  { label: string; dot: "success" | "muted" | "error"; dim?: boolean }
> = {
  running: { label: "Running", dot: "success" },
  completed: { label: "Completed", dot: "success" },
  idle: { label: "Idle", dot: "muted" },
  scheduled: { label: "Scheduled", dot: "muted" },
  queued: { label: "Queued", dot: "muted" },
  offline: { label: "Offline", dot: "error", dim: true },
  failed: { label: "Failed", dot: "error" },
};

/* Pill with a status dot: success for running/completed, muted for idle,
   scheduled and queued, error (60% opacity) for offline, error for failed. */
export function StatusChip({
  state,
}: {
  state: "running" | "idle" | "offline" | "queued" | "scheduled" | "completed" | "failed";
}) {
  const meta = STATUS_META[state] ?? { label: state, dot: "muted" as const };
  const dotColor =
    meta.dot === "success" ? "var(--success)" : meta.dot === "error" ? "var(--error)" : "var(--text-muted)";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-raised px-2.5 py-1 text-xs text-ink-dim">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: dotColor, opacity: meta.dim ? 0.6 : 1 }}
        aria-hidden="true"
      />
      {meta.label}
    </span>
  );
}

/* Circular colored well with the device's initial letter. */
export function DeviceAvatar({
  name,
  color,
  size = 40,
}: {
  name: string;
  color: string;
  size?: number;
}) {
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        fontSize: Math.round(size * 0.4),
      }}
    >
      {initial}
    </span>
  );
}

const TONE_COLOR: Record<string, string> = {
  default: "var(--text-secondary)",
  success: "var(--success)",
  error: "var(--error)",
};

/* Agent-style event feed message. Agent side: rounded-2xl surface card with a
   circular icon well. User side: narrower right-aligned pill with a UserRound
   icon. The timestamp sits small and muted above the bubble. */
export function EventMessage({
  icon,
  text,
  ts,
  side,
  iconTone = "default",
}: {
  icon: React.ReactNode;
  text: string;
  ts: string;
  side: "agent" | "user";
  iconTone?: "default" | "success" | "error";
}) {
  const iconColor = TONE_COLOR[iconTone] ?? TONE_COLOR.default;
  return (
    <div className={`flex flex-col ${side === "user" ? "items-end" : "items-start"}`}>
      <span className="tnum mb-1 text-xs text-ink-mute">{ts}</span>
      {side === "agent" ? (
        <div className="flex max-w-[85%] items-start gap-3 rounded-card border border-hairline bg-surface px-4 py-3">
          <IconWell size={36}>
            <span style={{ color: iconColor }} className="inline-flex">
              {icon}
            </span>
          </IconWell>
          <p className="pt-1.5 text-sm leading-relaxed text-ink">{text}</p>
        </div>
      ) : (
        <div className="inline-flex max-w-[70%] items-center gap-3 rounded-card border border-hairline bg-raised px-4 py-2.5">
          <p className="text-sm leading-relaxed text-ink">{text}</p>
          <UserRound size={16} strokeWidth={1.75} className="shrink-0 text-ink-mute" />
        </div>
      )}
    </div>
  );
}

/* Rounded input bar: plus button, text field, white submit button.
   Enter sends. When disabled, a line under the bar explains why. */
export function Composer({
  placeholder,
  onSend,
  disabled,
}: {
  placeholder: string;
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = React.useState("");

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
  };

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className={`flex items-center gap-2 rounded-[20px] border border-hairline bg-surface p-2 transition-opacity ${
          disabled ? "opacity-60" : ""
        }`}
      >
        <button
          type="button"
          aria-label="Add attachment"
          disabled={disabled}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-raised text-ink-dim transition-colors hover:bg-hover disabled:cursor-not-allowed"
        >
          <Plus size={18} strokeWidth={1.75} />
        </button>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          aria-label="Message"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-mute disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={disabled || value.trim().length === 0}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#0B0E12] transition-colors hover:bg-[#E8ECF2] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowUp size={16} strokeWidth={2.25} />
        </button>
      </form>
      {disabled ? (
        <p className="px-1 pt-2 text-xs text-ink-mute">
          Sending is unavailable until a device is connected.
        </p>
      ) : null}
    </div>
  );
}

/* Raised metric tile: icon well and label, big tabular value, quiet sub,
   and an optional footer slot (progress bar, delta chip, sparkline). */
export function MetricCard({
  icon,
  label,
  value,
  sub,
  footer,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-hairline bg-surface p-5">
      <div className="flex items-center gap-3">
        <IconWell size={40}>{icon}</IconWell>
        <span className="text-sm text-ink-dim">{label}</span>
      </div>
      <div className="tnum mt-3 text-[32px] font-semibold leading-none tracking-tight text-ink">
        {value}
      </div>
      {sub ? <div className="mt-1.5 text-[13px] text-ink-mute">{sub}</div> : null}
      {footer ? <div className="mt-4">{footer}</div> : null}
    </div>
  );
}

/* Raised surface card with a hairline border. */
export function SectionCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-card border border-hairline bg-surface ${className ?? ""}`}>
      {children}
    </div>
  );
}
