export const dynamic = "force-dynamic";

import { getPipelineStats, getNicheConfigs } from "@/lib/db";

const NICHE_COLORS: Record<string, string> = {
  ecom: "#F59E0B", ai_tech: "#3B82F6", business: "#8B5CF6", lifestyle: "#22C55E",
};

export default function AnalyticsPage() {
  const stats = getPipelineStats();
  const niches = getNicheConfigs();

  const conversionRate = stats.total_scraped > 0
    ? ((stats.total_delivered / stats.total_scraped) * 100).toFixed(1)
    : "0.0";

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ padding: "32px 0 28px", borderBottom: "1px solid var(--border-subtle)", marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Analytics</h1>
        <p style={{ fontSize: 13, color: "var(--text-tertiary)", marginTop: 4 }}>
          Pipeline performance and per-phone breakdown
        </p>
      </div>

      {/* Pipeline funnel */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 16 }}>
          Pipeline Funnel
        </div>
        <div className="card">
          {[
            { label: "Scraped", value: stats.total_scraped, pct: 100 },
            { label: "Variations Generated", value: stats.total_variations, pct: stats.total_scraped > 0 ? (stats.total_variations / (stats.total_scraped * 3)) * 100 : 0 },
            { label: "Variations Ready", value: stats.variations_ready, pct: stats.total_variations > 0 ? (stats.variations_ready / stats.total_variations) * 100 : 0 },
            { label: "Pending Approval", value: stats.pending_approvals, pct: stats.variations_ready > 0 ? (stats.pending_approvals / stats.variations_ready) * 100 : 0 },
            { label: "Posted", value: stats.total_delivered, pct: stats.total_scraped > 0 ? (stats.total_delivered / stats.total_scraped) * 100 : 0 },
          ].map((row, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 16,
              padding: "12px 0",
              borderBottom: i < 4 ? "1px solid var(--border-subtle)" : "none",
            }}>
              <div style={{ width: 140, fontSize: 12, color: "var(--text-secondary)", flexShrink: 0 }}>
                {row.label}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{
                  height: 6, borderRadius: 9999,
                  background: "var(--border-subtle)", overflow: "hidden",
                }}>
                  <div style={{
                    width: `${Math.min(100, row.pct)}%`, height: "100%",
                    borderRadius: 9999, background: "rgba(255,255,255,0.6)",
                    transition: "width 0.4s ease",
                  }} />
                </div>
              </div>
              <div style={{
                width: 60, textAlign: "right",
                fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em",
                color: "var(--text-primary)",
              }}>
                {row.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Key metrics */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 16 }}>
          Key Metrics
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {[
            { label: "Conversion Rate", value: `${conversionRate}%`, sub: "Scraped → Posted" },
            { label: "Avg Variations/Video", value: stats.total_scraped > 0 ? (stats.total_variations / stats.total_scraped).toFixed(1) : "0", sub: "Target: 3.0" },
            { label: "Metadata Injection", value: `${stats.variations_ready}`, sub: "Videos ready with iPhone fingerprint" },
          ].map((m, i) => (
            <div key={i} className="card-sm">
              <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>{m.label}</div>
              <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>{m.value}</div>
              <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>{m.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Per-phone table */}
      <div>
        <div style={{ fontSize: 11, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 16 }}>
          Per-Phone Breakdown
        </div>
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Phone</th>
                <th>Niche</th>
                <th>TikTok</th>
                <th>Instagram</th>
                <th>LinkedIn</th>
                <th>Scraped</th>
                <th>Posted</th>
              </tr>
            </thead>
            <tbody>
              {niches.map(nc => {
                const ps = stats.by_phone[nc.phone_number] ?? { scraped: 0, posted: 0 };
                const color = NICHE_COLORS[nc.niche] ?? "#666";
                return (
                  <tr key={nc.phone_number}>
                    <td>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block" }} />
                        Phone {nc.phone_number}
                      </span>
                    </td>
                    <td>{nc.niche_name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{nc.tiktok_handle || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{nc.instagram_handle || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{nc.linkedin_handle || "—"}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{ps.scraped}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums", color: ps.posted > 0 ? "#22C55E" : "var(--text-tertiary)" }}>
                      {ps.posted}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
