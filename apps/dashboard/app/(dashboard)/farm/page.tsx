export const dynamic = "force-dynamic";

import Link from "next/link";
import { listFarmDevices, getFarmHealth, listFarmTasks } from "@/lib/farmDb";
import { getPipelineStats } from "@/lib/db";
import { FARM_TEMPLATES } from "@/lib/farmTypes";
import { FarmTaskDispatch } from "./FarmTaskDispatch";

function StatusDot({ state }: { state: string }) {
  const colors: Record<string, string> = {
    idle: "bg-gray-400",
    warmup: "bg-emerald-500 animate-pulse",
    posting: "bg-blue-500 animate-pulse",
    scraping: "bg-amber-500 animate-pulse",
    running: "bg-emerald-500 animate-pulse",
    error: "bg-red-500",
    cooldown: "bg-orange-400",
  };
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[state] || colors.idle}`} />;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function FarmPage() {
  const devices = listFarmDevices();
  const health = getFarmHealth();
  const tasks = listFarmTasks();
  const pipeline = getPipelineStats();

  const healthMap = new Map(health.map((h) => [h.device_id, h]));
  const activeDevices = devices.filter((d) => {
    const h = healthMap.get(d.id);
    return h && h.session_state !== "idle";
  });
  const totalSwipes = health.reduce((s, h) => s + (h.swipes || 0), 0);
  const totalLikes = health.reduce((s, h) => s + (h.likes || 0), 0);
  const totalSaves = health.reduce((s, h) => s + (h.saves || 0), 0);
  const runningTasks = tasks.filter((t) => t.status === "running" || t.status === "scheduled");

  return (
    <div className="max-w-7xl mx-auto space-y-10">
      <div>
        <span className="text-xs font-bold text-[var(--primary)] tracking-widest uppercase mb-2 block">
          Phone Farm Control
        </span>
        <h3 className="text-4xl font-extrabold tracking-tight text-[var(--on-surface)]">Farm Overview</h3>
        <p className="text-sm text-[var(--on-surface-variant)] mt-2">
          {devices.length} nodes registered &middot; {activeDevices.length} active &middot; {runningTasks.length} tasks queued
        </p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          { label: "Total Likes", value: formatNum(totalLikes), change: `${devices.length} nodes`, icon: "favorite" },
          { label: "Total Saves", value: formatNum(totalSaves), change: `${totalSwipes} swipes`, icon: "bookmark" },
          { label: "Pipeline Items", value: formatNum(pipeline.total_scraped), change: `${pipeline.total_delivered} posted`, icon: "database" },
          { label: "Active Nodes", value: String(activeDevices.length), change: activeDevices.length > 0 ? "Live" : "Idle", icon: "devices", featured: true },
        ].map((item) => (
          <div
            key={item.label}
            className={`group relative overflow-hidden p-6 rounded-3xl transition-all ${
              item.featured
                ? "bg-[var(--primary)] text-white hover:shadow-2xl hover:shadow-blue-500/30"
                : "bg-[var(--surface-container-low)] hover:bg-[var(--surface-container-lowest)] hover:shadow-2xl hover:shadow-blue-500/5"
            }`}
          >
            <div className="flex justify-between items-start mb-4">
              <div className={`p-2 rounded-xl ${item.featured ? "bg-white/20" : "bg-[var(--primary)]/10 text-[var(--primary)]"}`}>
                <span className="material-symbols-outlined">{item.icon}</span>
              </div>
              <span
                className={`text-xs font-bold px-2 py-1 rounded-full ${
                  item.featured ? "text-white/80 border border-white/20" : "text-emerald-600 bg-emerald-50"
                }`}
              >
                {item.change}
              </span>
            </div>
            <div className="space-y-1">
              <p className={`text-2xl font-black tracking-tight ${item.featured ? "" : "text-[var(--on-surface)]"}`}>{item.value}</p>
              <p className={`text-sm font-medium ${item.featured ? "text-white/70" : "text-[var(--secondary)]"}`}>{item.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Device Grid + Node Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h4 className="text-xl font-bold tracking-tight text-[var(--on-surface)]">Device Nodes</h4>
            <span className="text-xs font-medium text-[var(--secondary)]">
              {devices.length} registered
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {devices.map((device) => {
              const h = healthMap.get(device.id);
              const state = h?.session_state || "idle";
              return (
                <div
                  key={device.id}
                  className="p-5 bg-[var(--surface-container-low)] rounded-[2rem] flex flex-col justify-between min-h-[180px] border border-transparent hover:border-blue-500/10 transition-all"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <StatusDot state={state} />
                      <span className="text-sm font-bold text-[var(--on-surface)]">{device.display_name}</span>
                    </div>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        state === "idle"
                          ? "text-[var(--secondary)] bg-[var(--surface-container-high)]"
                          : "text-emerald-700 bg-emerald-50"
                      }`}
                    >
                      {state}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 mt-4">
                    <div className="text-center">
                      <div className="text-lg font-bold text-[var(--on-surface)]">{h?.swipes || 0}</div>
                      <div className="text-[9px] uppercase tracking-wider text-[var(--secondary)] font-bold">Swipes</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-[var(--on-surface)]">{h?.likes || 0}</div>
                      <div className="text-[9px] uppercase tracking-wider text-[var(--secondary)] font-bold">Likes</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-[var(--on-surface)]">{h?.saves || 0}</div>
                      <div className="text-[9px] uppercase tracking-wider text-[var(--secondary)] font-bold">Saves</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-[var(--on-surface)]">{h?.comments || 0}</div>
                      <div className="text-[9px] uppercase tracking-wider text-[var(--secondary)] font-bold">Comments</div>
                    </div>
                  </div>
                  {h?.last_action && (
                    <div className="mt-3 text-[11px] text-[var(--outline)] truncate">
                      Last: {h.last_action}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Farm Templates */}
        <div className="space-y-6">
          <h4 className="text-xl font-bold tracking-tight text-[var(--on-surface)]">Farm Templates</h4>
          <div className="bg-[var(--surface-container-low)] rounded-[2.5rem] p-5 space-y-3">
            {FARM_TEMPLATES.map((template) => (
              <div
                key={template.id}
                className="p-4 bg-[var(--surface-container-lowest)] rounded-2xl shadow-sm border border-[var(--outline-variant)]/5 hover:border-blue-500/10 transition-all"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center text-[var(--primary)]">
                      <span className="material-symbols-outlined text-base">{template.icon}</span>
                    </div>
                    <div>
                      <span className="text-sm font-bold text-[var(--on-surface)]">{template.name}</span>
                      <div className="text-[10px] text-[var(--outline)]">{template.estimatedMinutes}m</div>
                    </div>
                  </div>
                  <FarmTaskDispatch
                    templateId={template.id}
                    taskType={template.taskType}
                    defaultPayload={template.defaultPayload}
                    devices={devices.map((d) => ({ id: d.id, name: d.display_name }))}
                  />
                </div>
                <p className="text-[11px] text-[var(--secondary)] leading-relaxed">{template.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Tasks */}
      {tasks.length > 0 && (
        <div>
          <h4 className="text-xl font-bold tracking-tight text-[var(--on-surface)] mb-4">Recent Tasks</h4>
          <div className="bg-[var(--surface-container-lowest)] rounded-2xl overflow-hidden shadow-sm border border-[var(--outline-variant)]/10">
            <table className="w-full text-left">
              <thead>
                <tr>
                  {["Type", "Device", "Scheduled", "Status"].map((h) => (
                    <th key={h} className="px-5 py-3 text-[10px] font-bold tracking-widest uppercase text-[var(--secondary)] bg-[var(--surface-container-low)]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.slice(0, 15).map((task) => (
                  <tr key={task.id} className="hover:bg-[var(--surface-container-low)] transition-colors border-t border-[var(--outline-variant)]/10">
                    <td className="px-5 py-3.5 text-xs font-bold text-[var(--on-surface)] uppercase">{task.type}</td>
                    <td className="px-5 py-3.5 text-xs text-[var(--secondary)]">{task.device_id || "Any"}</td>
                    <td className="px-5 py-3.5 text-xs text-[var(--outline)] font-mono">{task.scheduled_for?.slice(0, 16)}</td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          task.status === "succeeded"
                            ? "text-emerald-700 bg-emerald-50"
                            : task.status === "running"
                            ? "text-blue-700 bg-blue-50"
                            : task.status === "failed"
                            ? "text-red-700 bg-red-50"
                            : "text-[var(--secondary)] bg-[var(--surface-container-high)]"
                        }`}
                      >
                        {task.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="text-center py-8">
        <Link href="/calendar" className="btn-primary inline-flex items-center gap-2">
          <span className="material-symbols-outlined text-sm">calendar_month</span>
          Open Master Calendar
        </Link>
      </div>
    </div>
  );
}
