"use client";

import React from "react";
import { ArrowRightLeft } from "lucide-react";

/* Slim system card for handoff events (data.kind === "handoff"). The sentence
   is assembled from whatever fields the event actually carries; when the
   payload is missing pieces, the stored event text is shown as-is instead of
   a half-invented sentence. */

type HandoffData = {
  fromAgentName?: unknown;
  fromName?: unknown;
  from?: unknown;
  toAgentName?: unknown;
  toName?: unknown;
  to?: unknown;
  taskTitle?: unknown;
  task?: unknown;
  title?: unknown;
  note?: unknown;
  [key: string]: unknown;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function HandoffCard({
  text,
  data,
}: {
  text: string;
  data: Record<string, unknown> | null;
}) {
  const d: HandoffData = (data ?? {}) as HandoffData;
  const from = str(d.fromAgentName) ?? str(d.fromName) ?? str(d.from);
  const to = str(d.toAgentName) ?? str(d.toName) ?? str(d.to);
  const task = str(d.taskTitle) ?? str(d.task) ?? str(d.title);
  const note = str(d.note);
  const complete = Boolean(from && to && task);

  return (
    <div className="flex items-start gap-2.5 rounded-card border border-hairline bg-surface px-3.5 py-2.5 max-w-[85%]">
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-raised text-ink-dim">
        <ArrowRightLeft size={13} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <div className="min-w-0 pt-0.5">
        {complete ? (
          <p className="text-[12.5px] leading-relaxed text-ink-dim">
            <span className="font-medium text-ink">{from}</span>
            {` handed `}
            <span className="font-medium text-ink">{`"${task}"`}</span>
            {` to `}
            <span className="font-medium text-ink">{to}</span>
          </p>
        ) : (
          <p className="text-[12.5px] leading-relaxed text-ink-dim">{text}</p>
        )}
        {note && <p className="mt-0.5 text-[12px] leading-relaxed text-ink-mute">{note}</p>}
      </div>
    </div>
  );
}
