"use client";

import React from "react";
import AnalysisRadar from "./AnalysisRadar";
import { BrainCircuit, Target, Zap, AlertTriangle, CheckCircle2 } from "lucide-react";

interface CMOAnalysisCardProps {
  analysis: {
    cmo_score: number;
    verdict: string;
    why_worked: string;
    why_failed: string;
    strategic_prescription: string;
    axis_hook_power: number;
    axis_emotional_velocity: number;
    axis_curiosity_gap: number;
    axis_identity_mirror: number;
    axis_algorithm_hygiene: number;
    axis_niche_authority: number;
    axis_platform_fitness: number;
    axis_shareability: number;
    axis_retention_engineering: number;
    axis_production_value: number;
    source_creator?: string;
    source_url?: string;
  };
}

export function CMOAnalysisCard({ analysis }: CMOAnalysisCardProps) {
  const isRejected = analysis.verdict === "rejected";
  const isPromising = analysis.verdict === "promising";

  return (
    <div className="card overflow-hidden transition-all hover:border-white/10">
      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-6">
        {/* Radar Chart Side */}
        <div className="p-4 bg-neutral-900/40 border-r border-border flex flex-col items-center">
          <div className="flex items-center justify-between w-full mb-4">
            <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">
              10-Axis Virality
            </div>
            <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight
              ${isPromising ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 
                isRejected ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 
                'bg-white/10 text-white border border-white/20'}
            `}>
              {analysis.verdict}
            </div>
          </div>
          
          <AnalysisRadar data={[
            { axis: "Hook", value: analysis.axis_hook_power ?? 0 },
            { axis: "Emotion", value: analysis.axis_emotional_velocity ?? 0 },
            { axis: "Curiosity", value: analysis.axis_curiosity_gap ?? 0 },
            { axis: "Algorithm", value: analysis.axis_algorithm_hygiene ?? 0 },
            { axis: "Niche", value: analysis.axis_niche_authority ?? 0 },
            { axis: "Platform", value: analysis.axis_platform_fitness ?? 0 },
            { axis: "Share", value: analysis.axis_shareability ?? 0 },
            { axis: "Retention", value: analysis.axis_retention_engineering ?? 0 },
          ]} />

          <div className="mt-4 text-center">
            <div className="text-4xl font-black font-mono tracking-tighter text-white">
              {analysis.cmo_score}
            </div>
            <div className="text-[10px] text-neutral-600 font-bold uppercase tracking-widest">
              CMO Score
            </div>
          </div>
        </div>

        {/* Intelligence Side */}
        <div className="p-6">
          <div className="flex items-center gap-2 text-xs text-neutral-400 uppercase tracking-widest font-bold mb-6">
            <BrainCircuit size={14} className="text-white" />
            CMO Strategic Intent
          </div>

          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-2 text-[10px] text-green-500 uppercase tracking-widest font-bold mb-2">
                <CheckCircle2 size={12} /> Catalyst (Why Worked)
              </div>
              <p className="text-sm text-neutral-300 leading-relaxed italic">
                "{analysis.why_worked}"
              </p>
            </div>

            {analysis.why_failed && (
              <div>
                <div className="flex items-center gap-2 text-[10px] text-red-500 uppercase tracking-widest font-bold mb-2">
                  <AlertTriangle size={12} /> Resistance (Why Failed)
                </div>
                <p className="text-sm text-neutral-400 leading-relaxed font-medium">
                  {analysis.why_failed}
                </p>
              </div>
            )}

            <div className="p-4 bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/20 rounded">
              <div className="flex items-center gap-2 text-[10px] text-[var(--color-primary)] uppercase tracking-widest font-bold mb-2">
                <Zap size={12} /> Strategic Prescription
              </div>
              <p className="text-sm text-white leading-relaxed font-semibold">
                {analysis.strategic_prescription}
              </p>
            </div>
          </div>

          {analysis.source_creator && (
            <div className="mt-8 pt-4 border-t border-border flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-500">@{analysis.source_creator}</span>
              <a 
                href={analysis.source_url} 
                target="_blank" 
                className="text-[10px] font-bold text-neutral-400 hover:text-white transition-colors underline decoration-neutral-800"
              >
                View Source Content
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
