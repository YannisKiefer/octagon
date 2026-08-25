export const dynamic = "force-dynamic";

import { getAllViralDNA, getAccountAudits } from "@/lib/db";
import NodeHeader from "@/components/layout/NodeHeader";
import AnalysisRadar from "@/components/cmo/AnalysisRadar";

export const revalidate = 0;

export default function CMOIntelligencePage() {
  const viralDNA = getAllViralDNA();
  const audits = getAccountAudits();

  return (
    <div className="max-w-7xl mx-auto space-y-12">
      <NodeHeader title="CMO Intelligence" status="Synthesizing strategic insights" />

      <div className="grid grid-cols-12 gap-8">
        {/* Viral DNA Genome Map */}
        <div className="col-span-12 xl:col-span-4 space-y-6">
          <div className="bg-[var(--surface-container-lowest)] p-6 rounded-[2rem] shadow-sm border border-[var(--outline-variant)]/10">
            <h3 className="text-sm font-bold uppercase tracking-widest text-[var(--secondary)] mb-6">
              Account Genome Map
            </h3>
            <div className="space-y-6">
              {viralDNA.map((dna, idx) => (
                <div key={`${dna.handle}-${idx}`} className="space-y-3">
                  <div className="flex justify-between items-end">
                    <p className="text-[var(--on-surface)] font-bold text-lg">@{dna.handle}</p>
                    <span className="text-[10px] font-mono text-[var(--secondary)] uppercase">
                      Hit Rate: {dna.total_analyzed > 0 ? ((dna.viral_win_count / dna.total_analyzed) * 100).toFixed(1) : 0}%
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {JSON.parse(dna.top_hooks || "[]").slice(0, 3).map((h: any, i: number) => (
                      <span key={i} className="bg-[var(--primary)] text-white text-[9px] font-bold uppercase px-2.5 py-1 rounded-full">
                        {typeof h === 'object' ? h.pattern : h}
                      </span>
                    ))}
                    {JSON.parse(dna.winning_emotions || "[]").slice(0, 2).map((e: string, i: number) => (
                      <span key={i} className="border border-[var(--outline-variant)] text-[var(--on-surface)] text-[9px] font-bold uppercase px-2.5 py-1 rounded-full">
                        {e}
                      </span>
                    ))}
                  </div>
                  {(() => {
                    const clusters = JSON.parse(dna.cluster_labels || "[]") as Array<{ cluster_id: number; label: string; size: number; avg_score: number }>;
                    if (!clusters.length) return null;
                    return (
                      <div className="mt-3 space-y-1.5">
                        <p className="text-[8px] font-bold text-[var(--outline)] uppercase tracking-widest">Content Clusters</p>
                        {clusters.map((c) => (
                          <div key={c.cluster_id} className="flex items-start gap-2">
                            <span className="shrink-0 bg-[var(--surface-container-high)] text-[var(--on-surface)] font-mono text-[8px] px-1.5 py-0.5 rounded">
                              C{c.cluster_id}
                            </span>
                            <p className="font-mono text-[9px] text-[var(--secondary)] leading-snug">{c.label}</p>
                            <span className="shrink-0 ml-auto font-mono text-[8px] text-[var(--outline)]">
                              {c.size}x
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  <div className="h-px w-full bg-[var(--outline-variant)]/20"></div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Intelligence Feed */}
        <div className="col-span-12 xl:col-span-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {audits.map((audit) => (
              <div key={audit.id} className="bg-[var(--surface-container-lowest)] rounded-[2rem] overflow-hidden flex flex-col h-[550px] shadow-sm border border-[var(--outline-variant)]/10">
                <div className="p-6 flex justify-between items-center">
                  <div>
                    <span className="text-[10px] font-bold text-[var(--secondary)] uppercase block mb-1">Entity Audit</span>
                    <h4 className="text-xl font-bold text-[var(--on-surface)] tracking-tight">
                      @{audit.account_handle}
                    </h4>
                  </div>
                  <div className="text-right">
                    <span className="text-4xl font-extrabold text-[var(--primary)]">
                      {audit.cmo_score}
                    </span>
                    <span className="text-[10px] font-bold text-[var(--secondary)] block mt-1 uppercase">V_INDEX</span>
                  </div>
                </div>

                <div className="flex-1 bg-[var(--surface-container-low)] relative flex items-center justify-center p-4">
                  <AnalysisRadar 
                    data={[
                      { axis: "Hook Power", value: audit.axis_hook_power },
                      { axis: "Retention Arc", value: audit.axis_retention_architecture },
                      { axis: "Emotional Velocity", value: audit.axis_emotional_velocity },
                      { axis: "Curiosity Gap", value: audit.axis_curiosity_gap },
                      { axis: "Platform Fitness", value: audit.axis_platform_fitness },
                      { axis: "Shareability", value: audit.axis_shareability_trigger },
                      { axis: "Algorithm Hygiene", value: audit.axis_algorithm_hygiene },
                      { axis: "Niche Authority", value: audit.axis_niche_authority },
                    ]}
                  />
                </div>

                <div className="p-6 bg-[var(--surface-container-low)] border-t border-[var(--outline-variant)]/10 text-sm text-[var(--secondary)] line-clamp-3 italic">
                  {audit.highest_leverage_intervention || audit.why_worked}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
