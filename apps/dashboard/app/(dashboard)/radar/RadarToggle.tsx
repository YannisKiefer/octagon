"use client";

import React, { useState, useEffect } from "react";
import { Activity } from "lucide-react";

export function RadarToggle() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/radar")
      .then((res) => res.json())
      .then((data) => {
        setEnabled(data.enabled);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load radar status", err);
        setLoading(false);
      });
  }, []);

  const toggle = async () => {
    if (loading) return;
    setLoading(true);
    const newState = !enabled;
    try {
      await fetch("/api/radar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newState }),
      });
      setEnabled(newState);
    } catch (err) {
      console.error("Failed to toggle radar", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-3 bg-[var(--surface-container-lowest)] rounded-xl p-2 pr-4 shadow-sm border border-[var(--outline-variant)]/10">
      <div className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-[var(--surface-container-high)] text-[var(--secondary)]'}`}>
        <Activity size={18} className={enabled ? 'animate-pulse' : ''} />
      </div>
      <div>
        <div className="text-xs font-bold text-[var(--on-surface)] uppercase tracking-wider">Auto-Radar</div>
        <div className="text-[10px] text-[var(--secondary)]">{enabled ? 'Active (2h Sweep)' : 'Paused'}</div>
      </div>
      
      <button 
        onClick={toggle}
        disabled={loading}
        className={`ml-4 relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 ${enabled ? 'bg-emerald-500' : 'bg-[var(--surface-container-highest)]'}`}
      >
        <span className="sr-only">Toggle Radar</span>
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${enabled ? 'translate-x-2' : '-translate-x-2'}`}
        />
      </button>
    </div>
  );
}
