import React from "react";
import { DeviceAvatar } from "./ui";

type PreviewState = "live" | "stale" | "unavailable";

const PREVIEW_META: Record<PreviewState, { label: string; dot: string }> = {
  live: { label: "Live", dot: "var(--success)" },
  stale: { label: "Stale", dot: "var(--text-muted)" },
  unavailable: { label: "Unavailable", dot: "var(--text-muted)" },
};

/* Static phone preview: renders the device artwork PNG from public/phones/.
   The word "Live" only ever appears for state="live" (real frames; nothing
   sets that today). For unavailable: dimmed artwork with the honest capture
   note centered on top. */
export function PhonePreview({
  artwork,
  state,
  note,
}: {
  artwork: string | null;
  state: PreviewState;
  note?: string;
}) {
  const meta = PREVIEW_META[state];
  const dimmed = state === "unavailable";

  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <span className="text-[13px] font-medium text-ink-dim">Device preview</span>
        <span className="flex items-center gap-1.5 text-xs text-ink-mute">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: meta.dot, opacity: state === "live" ? 1 : 0.8 }}
            aria-hidden="true"
          />
          {meta.label}
        </span>
      </div>
      <div className="relative flex items-center justify-center bg-canvas p-3">
        {artwork ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artwork}
            alt="Device preview"
            draggable={false}
            className={`max-h-[420px] w-auto max-w-full object-contain ${
              dimmed ? "opacity-30" : ""
            }`}
          />
        ) : (
          <div
            className="flex h-[260px] w-full items-center justify-center rounded-control border border-hairline"
            aria-hidden="true"
          />
        )}
        {dimmed && note ? (
          <p className="absolute inset-x-0 flex items-center justify-center px-8 text-center text-[13px] leading-relaxed text-ink-dim">
            {note}
          </p>
        ) : null}
      </div>
      {note && !dimmed ? (
        <p className="border-t border-hairline px-4 py-2.5 text-xs text-ink-mute">{note}</p>
      ) : null}
    </div>
  );
}

/* Device header row: artwork thumbnail when a capture exists, colored initial
   avatar otherwise, next to the device name and sub line. */
export function DeviceIdentity({
  name,
  sub,
  artwork,
  color,
  size = 44,
}: {
  name: string;
  sub?: string;
  artwork: string | null;
  color: string;
  size?: number;
}) {
  return (
    <div className="flex items-center gap-3">
      {artwork ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artwork}
          alt=""
          draggable={false}
          className="shrink-0 rounded-control border border-hairline object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <DeviceAvatar name={name} color={color} size={size} />
      )}
      <div className="min-w-0">
        <div className="truncate text-base font-semibold text-ink">{name}</div>
        {sub ? <div className="truncate text-[13px] text-ink-mute">{sub}</div> : null}
      </div>
    </div>
  );
}
