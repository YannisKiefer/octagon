"use client";

import { useState } from "react";

type Props = {
  templateId: string;
  taskType: string;
  defaultPayload: Record<string, unknown>;
  devices: Array<{ id: string; name: string }>;
};

export function FarmTaskDispatch({ templateId, taskType, defaultPayload, devices }: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function dispatch(deviceId: string | null) {
    setDispatching(true);
    setResult(null);
    try {
      const res = await fetch("/api/farm/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: taskType,
          device_id: deviceId,
          payload: { ...defaultPayload, template: templateId },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setResult("Dispatched");
        setShowPicker(false);
        setTimeout(() => setResult(null), 2000);
      } else {
        setResult(data.error || "Failed");
      }
    } catch {
      setResult("Network error");
    } finally {
      setDispatching(false);
    }
  }

  if (result) {
    return (
      <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
        result === "Dispatched" ? "text-emerald-700 bg-emerald-50" : "text-red-700 bg-red-50"
      }`}>
        {result}
      </span>
    );
  }

  if (showPicker) {
    return (
      <div className="flex items-center gap-1">
        {devices.map((d) => (
          <button
            key={d.id}
            onClick={() => dispatch(d.id)}
            disabled={dispatching}
            className="text-[9px] font-bold px-2 py-1 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white transition-all disabled:opacity-50"
          >
            {d.name.split("(")[0].trim().slice(0, 8)}
          </button>
        ))}
        <button
          onClick={() => setShowPicker(false)}
          className="text-[9px] text-[var(--outline)] hover:text-[var(--on-surface)]"
        >
          &times;
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowPicker(true)}
      className="text-[10px] font-bold px-3 py-1.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white transition-all"
    >
      Deploy
    </button>
  );
}
