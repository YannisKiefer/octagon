export const dynamic = "force-dynamic";

import React from "react";
import { 
  getPipelineStats, 
  getRecentScraped, 
  getUnifiedKPIs, 
  getLatestPrescriptions 
} from "@/lib/db";
import NodeHeader from "@/components/layout/NodeHeader";

export const revalidate = 0;

const fmtNum = (n: number) => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
};

export default function OverviewPage() {
  const stats = getPipelineStats();
  const recent = getRecentScraped(15);
  const kpis = getUnifiedKPIs();
  const prescriptions = getLatestPrescriptions(1);
  const latestPrescription = prescriptions[0];

  return (
    <div className="max-w-7xl mx-auto space-y-12">
      <NodeHeader title="Fleet Performance" status="Consolidated metrics across all operational nodes" />

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-[var(--surface-container-low)] p-6 rounded-3xl relative overflow-hidden group hover:bg-[var(--surface-container-highest)] transition-colors">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <span className="material-symbols-outlined text-6xl">visibility</span>
          </div>
          <p className="text-[var(--secondary)] text-xs font-bold uppercase tracking-widest mb-2">Total Views</p>
          <div className="flex items-baseline gap-2">
            <h3 className="text-4xl font-extrabold tracking-tighter text-[var(--on-surface)]">{fmtNum(kpis.total_views)}</h3>
            <span className="text-emerald-600 text-xs font-bold">+24%</span>
          </div>
          <div className="mt-4 h-1 w-full bg-[var(--surface-container-highest)] rounded-full overflow-hidden">
            <div className="h-full bg-[var(--primary)] w-[90%] rounded-full"></div>
          </div>
        </div>

        <div className="bg-[var(--surface-container-low)] p-6 rounded-3xl relative overflow-hidden group hover:bg-[var(--surface-container-highest)] transition-colors">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <span className="material-symbols-outlined text-6xl">bolt</span>
          </div>
          <p className="text-[var(--secondary)] text-xs font-bold uppercase tracking-widest mb-2">Efficiency</p>
          <div className="flex items-baseline gap-2">
            <h3 className="text-4xl font-extrabold tracking-tighter text-[var(--on-surface)]">99.4%</h3>
            <span className="text-emerald-600 text-xs font-bold">Optimal</span>
          </div>
          <div className="mt-4 h-1 w-full bg-[var(--surface-container-highest)] rounded-full overflow-hidden">
            <div className="h-full bg-[var(--primary)] w-[99%] rounded-full"></div>
          </div>
        </div>

        <div className="bg-[var(--surface-container-low)] p-6 rounded-3xl relative overflow-hidden group hover:bg-[var(--surface-container-highest)] transition-colors">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <span className="material-symbols-outlined text-6xl">database</span>
          </div>
          <p className="text-[var(--secondary)] text-xs font-bold uppercase tracking-widest mb-2">Data Flow</p>
          <div className="flex items-baseline gap-2">
            <h3 className="text-4xl font-extrabold tracking-tighter text-[var(--on-surface)]">2.4 GB/s</h3>
            <span className="text-emerald-600 text-xs font-bold">+12%</span>
          </div>
          <div className="mt-4 h-1 w-full bg-[var(--surface-container-highest)] rounded-full overflow-hidden">
            <div className="h-full bg-[var(--primary)] w-[75%] rounded-full"></div>
          </div>
        </div>

        <div className="bg-[var(--primary)] text-white p-6 rounded-3xl relative overflow-hidden group hover:shadow-2xl hover:shadow-blue-500/30 transition-all">
          <div className="absolute top-0 right-0 p-4 opacity-20">
            <span className="material-symbols-outlined text-6xl">monitoring</span>
          </div>
          <p className="text-white/70 text-xs font-bold uppercase tracking-widest mb-2">Nodes Active</p>
          <div className="flex items-baseline gap-2">
            <h3 className="text-4xl font-extrabold tracking-tighter">{stats.total_scraped}</h3>
            <span className="text-white/80 text-xs font-bold border border-white/20 px-2 py-0.5 rounded-full">Live</span>
          </div>
          <div className="mt-4 h-1 w-full bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-white w-[65%] rounded-full"></div>
          </div>
        </div>
      </div>

      {/* Main Content: Visual Stream + Active Directive */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8">
          <div className="bg-[var(--surface-container-lowest)] p-8 rounded-[2rem] shadow-sm border border-[var(--outline-variant)]/10 relative overflow-hidden">
            <div className="flex justify-between items-center mb-8">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-[var(--primary)] rounded-full"></div>
                <h3 className="text-lg font-bold text-[var(--on-surface)]">Active Node Stream</h3>
              </div>
              <div className="flex gap-4">
                <div className="flex flex-col items-end">
                  <span className="text-[10px] uppercase tracking-wider text-[var(--secondary)]">Latency</span>
                  <span className="text-sm font-bold text-[var(--on-surface)]">12ms</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] uppercase tracking-wider text-[var(--secondary)]">Uptime</span>
                  <span className="text-sm font-bold text-[var(--on-surface)]">{stats.total_scraped + 200}H</span>
                </div>
              </div>
            </div>

            <div className="relative aspect-video rounded-2xl overflow-hidden bg-[var(--inverse-surface)] flex items-center justify-center">
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 to-transparent opacity-60"></div>
              <div className="relative z-10 text-center p-8">
                {latestPrescription ? (
                  <div className="space-y-4">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-white/60">Active Directive</span>
                    <h4 className="text-xl font-bold text-white line-clamp-4">&ldquo;{latestPrescription.hook}&rdquo;</h4>
                    <p className="text-[10px] text-white/60 uppercase tracking-widest font-bold">Target: @{latestPrescription.handle}</p>
                  </div>
                ) : (
                  <span className="material-symbols-outlined text-white/20 text-9xl">all_inclusive</span>
                )}
              </div>
              <div className="absolute bottom-6 left-6 right-6 flex justify-between items-end z-10">
                <div className="flex items-center gap-2 text-white/90">
                  <span className="material-symbols-outlined text-sm">account_circle</span>
                  <span className="text-xs font-medium">NODE_SYNC_OK</span>
                </div>
                <div className="flex gap-2">
                  <div className="px-3 py-1 bg-white/10 backdrop-blur-md rounded-lg text-white text-[10px] font-bold border border-white/10">42% PWR</div>
                  <div className="px-3 py-1 bg-[var(--primary)] text-white rounded-lg text-[10px] font-bold">ACTIVE</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Cybernetic Log */}
        <div className="lg:col-span-4">
          <div className="bg-[var(--surface-container-low)] rounded-[2rem] p-6 h-full flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold text-[var(--on-surface)]">Activity Log</h3>
              <span className="w-2 h-2 bg-[var(--primary)] rounded-full animate-pulse"></span>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto">
              {recent.map((r, i) => (
                <div key={r.id} className={`p-3 rounded-xl transition-colors ${i === 0 ? "bg-[var(--surface-container-lowest)] shadow-sm" : ""}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] text-[var(--outline)] font-mono">
                      {new Date(r.created_at).toLocaleTimeString([], { hour12: false })}
                    </span>
                    <span className={`text-xs font-bold ${i === 0 ? "text-[var(--primary)]" : "text-[var(--secondary)]"}`}>
                      {r.scrape_status === 'downloaded' ? "PROCESSED" : "SCRAPED"}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--on-surface)] font-medium">@{r.source_creator}</p>
                  <p className="text-[11px] text-[var(--outline)] truncate mt-0.5">{r.caption}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Automation Core */}
      <div>
        <h3 className="text-xl font-bold tracking-tight text-[var(--on-surface)] mb-6">Automation Core</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Active Warmups", value: "12", icon: "local_fire_department", color: "blue" },
            { label: "Postings Queue", value: "4", icon: "publish", color: "purple" },
            { label: "Scraping Active", value: "8", icon: "database", color: "green" },
            { label: "Comments/Day", value: "22", icon: "forum", color: "orange" },
          ].map((item) => (
            <div key={item.label} className="bg-[var(--surface-container-low)] p-5 rounded-2xl flex items-center justify-between group hover:bg-[var(--surface-container-highest)] transition-all">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  item.color === "blue" ? "bg-blue-100 text-blue-600" :
                  item.color === "purple" ? "bg-purple-100 text-purple-600" :
                  item.color === "green" ? "bg-green-100 text-green-600" :
                  "bg-orange-100 text-orange-600"
                }`}>
                  <span className="material-symbols-outlined">{item.icon}</span>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[var(--on-surface)]">{item.label}</h4>
                  <p className="text-[10px] text-[var(--secondary)]">Active Instances</p>
                </div>
              </div>
              <span className={`text-lg font-black ${
                item.color === "blue" ? "text-blue-600" :
                item.color === "purple" ? "text-purple-600" :
                item.color === "green" ? "text-green-600" :
                "text-orange-600"
              }`}>{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
