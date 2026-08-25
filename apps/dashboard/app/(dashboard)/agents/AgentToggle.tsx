"use client";

import { useState } from "react";

export function AgentToggle({ team, currentStatus }: { team: string; currentStatus: string }) {
  const [status, setStatus] = useState(currentStatus);
  const [loading, setLoading] = useState(false);

  const isPaused = status === "paused";

  async function handleToggle() {
    setLoading(true);
    try {
      const res = await fetch("/api/agents/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team,
          action: isPaused ? "start" : "stop",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus(isPaused ? "running" : "paused");
      }
    } catch (e) {
      console.error("Toggle failed:", e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
        loading ? "opacity-50 cursor-wait" : "cursor-pointer"
      } ${
        isPaused
          ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          : "bg-red-50 text-red-700 hover:bg-red-100"
      }`}
    >
      {loading ? "..." : isPaused ? "\u25b6 Start" : "\u25a0 Stop"}
    </button>
  );
}
