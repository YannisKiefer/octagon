"use client";

import React from "react";
import { ArrowUp, Plus } from "lucide-react";
import type { Agent } from "./agents";

/* The conversation composer for the group chat. Same look as the shared
   Composer, plus the group-chat affordance: when the message starts with "@"
   a tiny hint under the bar names the agent being addressed, resolved against
   the real agent list with the same rule the server uses (the full name after
   "@", optionally followed by more words) - unknown names say so instead of
   guessing. onSend returns whether the message was sent; the draft is only
   cleared on success, so a failed send keeps the text for a retry. */
export function GroupComposer({
  placeholder,
  onSend,
  disabled,
  agents,
}: {
  placeholder: string;
  onSend: (text: string) => boolean | Promise<boolean>;
  disabled?: boolean;
  agents: Agent[];
}) {
  const [value, setValue] = React.useState("");

  const trimmedStart = value.trimStart();
  const addressing = trimmedStart.startsWith("@");
  const afterMention = addressing ? trimmedStart.slice(1).trimStart().toLowerCase() : "";

  let hint: string | null = null;
  if (addressing) {
    if (!afterMention) {
      hint = "Type an agent name after @";
    } else {
      const match = agents.find(
        (a) =>
          afterMention === a.name.toLowerCase() ||
          afterMention.startsWith(`${a.name.toLowerCase()} `),
      );
      hint = match
        ? `This will address ${match.name}`
        : `No agent matches "@${trimmedStart.slice(1).trim()}"`;
    }
  }

  const submit = async () => {
    const text = value.trim();
    if (!text || disabled) return;
    const ok = await onSend(text);
    if (ok) setValue("");
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
      {hint ? (
        <p className="px-1 pt-1.5 text-[11.5px] text-ink-dim" role="status">
          {hint}
        </p>
      ) : disabled ? (
        <p className="px-1 pt-1.5 text-xs text-ink-mute">
          Sending is unavailable until a device is connected.
        </p>
      ) : null}
    </div>
  );
}
