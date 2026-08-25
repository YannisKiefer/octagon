export const dynamic = "force-dynamic";

import { getAllAgentStats, getUnifiedActivity, getCrmLog } from "@/lib/agents-data";
import { getPipelineStats } from "@/lib/db";
import { AgentToggle } from "./AgentToggle";
import { GraduationCap, ShoppingBag, Twitter, Hexagon, Play, Pause, AlertTriangle, AlertCircle, Cpu, Activity, Clock, Users } from "lucide-react";

function getTeamIcon(team: string, size = 16) {
  switch (team) {
    case 'skool': return <GraduationCap size={size} />;
    case 'whop': return <ShoppingBag size={size} />;
    case 'twitter': return <Twitter size={size} />;
    case 'octragon': return <Hexagon size={size} />;
    default: return <Cpu size={size} />;
  }
}

function StatusPill({ status }: { status: string }) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] uppercase font-bold tracking-wider">
        <Play size={10} className="fill-emerald-600" /> Running
      </span>
    );
  }
  if (status === "paused") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--surface-container-high)] text-[var(--secondary)] text-[10px] uppercase font-bold tracking-wider">
        <Pause size={10} /> Paused
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 text-red-700 text-[10px] uppercase font-bold tracking-wider">
        <AlertTriangle size={10} /> Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--surface-container-high)] text-[var(--secondary)] text-[10px] uppercase font-bold tracking-wider">
      <AlertCircle size={10} /> Unknown
    </span>
  );
}

function KpiBlock({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="text-center p-4">
      <div className="text-2xl font-bold tracking-tight text-[var(--on-surface)]">
        {value}
      </div>
      <div className="text-[10px] text-[var(--secondary)] uppercase tracking-widest font-bold mt-1">
        {label}
      </div>
      {sub && <div className="text-[10px] text-[var(--outline)] mt-0.5 font-medium">{sub}</div>}
    </div>
  );
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr.slice(0, 16);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr.slice(0, 16);
  }
}

export default function AgentsPage() {
  const agents = getAllAgentStats();
  const octragonStats = getPipelineStats();
  const recentActivity = getUnifiedActivity(15);
  const crmLog = getCrmLog(10);

  return (
    <div className="max-w-[1100px] mx-auto space-y-8">
      <div>
        <span className="text-xs font-bold text-[var(--primary)] tracking-widest uppercase mb-2 block">Autonomous Pipelines</span>
        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--on-surface)] flex items-center gap-3">
          Agent Fleet
        </h1>
        <p className="text-sm text-[var(--on-surface-variant)] mt-1">
          Unified control panel for all autonomous pipelines
        </p>
      </div>

      {/* Pipeline Cards */}
      <div className="grid grid-cols-2 gap-4">
        {agents.map(agent => (
          <div key={agent.team} className="bg-[var(--surface-container-lowest)] rounded-2xl overflow-hidden shadow-sm border border-[var(--outline-variant)]/10">
            <div className="flex items-center justify-between px-5 py-4 bg-[var(--surface-container-low)]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center text-[var(--primary)]">
                  {getTeamIcon(agent.team)}
                </div>
                <div>
                  <div className="text-sm font-bold text-[var(--on-surface)]">{agent.label}</div>
                  <div className="text-[11px] text-[var(--secondary)] font-medium mt-0.5 flex items-center gap-1.5">
                    <Clock size={10} /> {formatDate(agent.lastActivity)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StatusPill status={agent.status} />
                {agent.team !== "twitter" && (
                  <AgentToggle team={agent.team} currentStatus={agent.status} />
                )}
              </div>
            </div>
            <div className={`grid ${agent.team === "twitter" ? "grid-cols-3" : "grid-cols-4"} divide-x divide-[var(--outline-variant)]/20`}>
              {agent.team === "twitter" ? (
                <>
                  <KpiBlock label="Content" value={agent.leadsReady} sub="agents" />
                  <KpiBlock label="Outreach" value={agent.dmsSentToday} sub="agents" />
                  <KpiBlock label="Signal" value={agent.leadsTotal} sub="agents" />
                </>
              ) : (
                <>
                  <KpiBlock label="Sent today" value={agent.dmsSentToday} />
                  <KpiBlock label="Total sent" value={agent.dmsSentTotal} />
                  <KpiBlock label="Ready" value={agent.leadsReady} sub="leads" />
                  <KpiBlock label="Total leads" value={agent.leadsTotal} />
                </>
              )}
            </div>
          </div>
        ))}

        <div className="bg-[var(--surface-container-lowest)] rounded-2xl overflow-hidden shadow-sm border border-[var(--outline-variant)]/10">
          <div className="flex items-center justify-between px-5 py-4 bg-[var(--surface-container-low)]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center text-[var(--primary)]">
                {getTeamIcon("octragon")}
              </div>
              <div>
                <div className="text-sm font-bold text-[var(--on-surface)]">Octragon Pipeline</div>
                <div className="text-[11px] text-[var(--secondary)] font-medium mt-0.5">4 active phones</div>
              </div>
            </div>
            <StatusPill status="running" />
          </div>
          <div className="grid grid-cols-4 divide-x divide-[var(--outline-variant)]/20">
            <KpiBlock label="Scraped" value={octragonStats.total_scraped} />
            <KpiBlock label="Variations" value={octragonStats.total_variations} />
            <KpiBlock label="Pending" value={octragonStats.pending_approvals} />
            <KpiBlock label="Delivered" value={octragonStats.total_delivered} />
          </div>
        </div>
      </div>

      {/* Bottom: Activity + CRM */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="text-xs text-[var(--secondary)] uppercase tracking-widest font-bold mb-4 flex items-center gap-2">
            <Activity size={14} className="text-[var(--primary)]" />
            Recent DM Activity
          </div>
          <div className="bg-[var(--surface-container-lowest)] rounded-2xl overflow-hidden shadow-sm border border-[var(--outline-variant)]/10">
            {recentActivity.length === 0 ? (
              <div className="p-8 text-center text-xs text-[var(--secondary)]">
                No outreach activity yet.
              </div>
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th className="px-5 py-3 text-[10px] font-bold tracking-widest uppercase text-[var(--secondary)] bg-[var(--surface-container-low)]">Platform</th>
                    <th className="px-5 py-3 text-[10px] font-bold tracking-widest uppercase text-[var(--secondary)] bg-[var(--surface-container-low)]">Community</th>
                    <th className="px-5 py-3 text-[10px] font-bold tracking-widest uppercase text-[var(--secondary)] bg-[var(--surface-container-low)]">Owner</th>
                    <th className="px-5 py-3 text-[10px] font-bold tracking-widest uppercase text-[var(--secondary)] bg-[var(--surface-container-low)]">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recentActivity.map((entry, i) => (
                    <tr key={`${entry.slug}-${i}`} className="hover:bg-[var(--surface-container-low)] transition-colors border-t border-[var(--outline-variant)]/10">
                      <td className="px-5 py-3.5">
                        <div className="inline-flex items-center gap-1.5 text-xs text-[var(--on-surface)] font-medium bg-[var(--surface-container-high)] px-2 py-0.5 rounded-full">
                          <span className="text-[var(--secondary)]">{getTeamIcon(entry.platform, 12)}</span>
                          <span className="capitalize">{entry.platform}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-[13px] text-[var(--on-surface)] font-medium max-w-[150px] truncate">{entry.slug}</td>
                      <td className="px-5 py-3.5 text-xs text-[var(--secondary)] max-w-[120px] truncate">{entry.owner || "\u2014"}</td>
                      <td className="px-5 py-3.5 text-xs text-[var(--outline)] font-mono">{entry.date.slice(0, 16)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div>
          <div className="text-xs text-[var(--secondary)] uppercase tracking-widest font-bold mb-4 flex items-center gap-2">
            <Users size={14} className="text-[var(--primary)]" />
            Cross-Platform CRM
          </div>
          <div className="bg-[var(--surface-container-lowest)] rounded-2xl overflow-hidden shadow-sm border border-[var(--outline-variant)]/10">
            {crmLog.length === 0 ? (
              <div className="p-8 text-center text-xs text-[var(--secondary)]">
                No CRM entries yet.
              </div>
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th className="px-5 py-3 text-[10px] font-bold tracking-widest uppercase text-[var(--secondary)] bg-[var(--surface-container-low)]">Platform</th>
                    <th className="px-5 py-3 text-[10px] font-bold tracking-widest uppercase text-[var(--secondary)] bg-[var(--surface-container-low)]">User</th>
                    <th className="px-5 py-3 text-[10px] font-bold tracking-widest uppercase text-[var(--secondary)] bg-[var(--surface-container-low)]">Preview</th>
                    <th className="px-5 py-3 text-[10px] font-bold tracking-widest uppercase text-[var(--secondary)] bg-[var(--surface-container-low)]">Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {crmLog.map((entry, i) => (
                    <tr key={`crm-${i}`} className="hover:bg-[var(--surface-container-low)] transition-colors border-t border-[var(--outline-variant)]/10">
                      <td className="px-5 py-3.5">
                        <div className="inline-flex items-center gap-1.5 text-xs text-[var(--on-surface)] font-medium bg-[var(--surface-container-high)] px-2 py-0.5 rounded-full">
                          <span className="text-[var(--secondary)]">{getTeamIcon(entry.platform, 12)}</span>
                          <span className="capitalize">{entry.platform}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-[13px] text-[var(--on-surface)] font-medium">@{entry.username}</td>
                      <td className="px-5 py-3.5 text-xs text-[var(--secondary)] max-w-[180px] truncate">{entry.messagePreview || "\u2014"}</td>
                      <td className="px-5 py-3.5 text-xs text-[var(--outline)] font-mono">{formatDate(entry.sentAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
