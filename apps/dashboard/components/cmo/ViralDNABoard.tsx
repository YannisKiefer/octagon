"use client";

import React from "react";
import { Fingerprint, TrendingUp, AlertTriangle, Zap, Target, Layers, Activity } from "lucide-react";

interface ViralDNABoardProps {
  dna: {
    account_id: string;
    handle: string;
    top_hooks: string; // JSON
    optimal_posting_times: string; // JSON
    winning_formats: string; // JSON
    winning_emotions: string; // JSON
    avg_engagement_rate: number;
    trend_direction: string;
    total_analyzed: number;
    dominant_axis_strengths: string; // JSON
    critical_axis_weaknesses: string; // JSON
    trajectory_note: string;
  };
}

export function ViralDNABoard({ dna }: ViralDNABoardProps) {
  const topHooks = JSON.parse(dna.top_hooks || "[]");
  const formats = JSON.parse(dna.winning_formats || "[]");
  const emotions = JSON.parse(dna.winning_emotions || "[]");
  const strengths = JSON.parse(dna.dominant_axis_strengths || "[]");
  const weaknesses = JSON.parse(dna.critical_axis_weaknesses || "[]");

  return (
    <div className="card p-8 bg-neutral-900/20 border border-white/5">
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/20 flex items-center justify-center text-[var(--color-primary)]">
            <Fingerprint size={24} />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-tight text-white uppercase italic">
              Viral DNA: @{dna.handle}
            </h2>
            <div className="flex items-center gap-3 mt-1.5">
              <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold">
                Synthesized Genome
              </span>
              <span className="text-neutral-700">•</span>
              <span className="text-[10px] text-[var(--color-primary)] uppercase tracking-widest font-bold flex items-center gap-1">
                <TrendingUp size={12} /> {dna.trend_direction}
              </span>
            </div>
          </div>
        </div>
        
        <div className="text-right">
          <div className="text-[10px] text-neutral-600 uppercase tracking-widest font-bold mb-1">
            Data Sample
          </div>
          <div className="text-lg font-mono font-bold text-white">
            {dna.total_analyzed} <span className="text-xs text-neutral-500">analyses</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {/* Core Strategy Axis */}
        <div className="space-y-6">
          <div>
            <div className="flex items-center gap-2 text-[10px] text-neutral-400 uppercase tracking-widest font-bold mb-3">
              <Target size={14} className="text-white" />
              Strategic Anchors
            </div>
            <div className="flex flex-wrap gap-2">
              {strengths.map((s: string, i: number) => (
                <span key={i} className="px-2 py-1 rounded-sm bg-white/5 border border-white/10 text-white text-[10px] font-bold uppercase tracking-wider">
                  {s}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 text-[10px] text-neutral-500 uppercase tracking-widest font-bold mb-3">
              <Layers size={14} className="text-neutral-400" />
              Winning Formats
            </div>
            <div className="space-y-2">
              {formats.map((f: string, i: number) => (
                <div key={i} className="text-xs text-neutral-300 flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-[var(--color-primary)]" />
                  {f}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Emotions & Trajectory */}
        <div className="space-y-6">
          <div>
            <div className="flex items-center gap-2 text-[10px] text-neutral-400 uppercase tracking-widest font-bold mb-3">
              <Zap size={14} className="text-yellow-500" />
              Dominant Emotions
            </div>
            <div className="flex flex-wrap gap-2">
              {emotions.map((e: string, i: number) => (
                <span key={i} className="px-2 py-1 rounded-sm bg-yellow-500/5 border border-yellow-500/20 text-yellow-500 text-[10px] font-bold uppercase tracking-wider">
                  {e}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 text-[10px] text-neutral-500 uppercase tracking-widest font-bold mb-3">
              <Activity size={14} className="text-neutral-400" />
              Trajectory Note
            </div>
            <p className="text-xs text-neutral-400 leading-relaxed font-medium">
              {dna.trajectory_note}
            </p>
          </div>
        </div>

        {/* Critical Weaknesses & Gaps */}
        <div className="card-sm bg-red-500/5 border-red-500/10">
          <div className="flex items-center gap-2 text-[10px] text-red-500 uppercase tracking-widest font-bold mb-4">
            <AlertTriangle size={14} /> Critical Weaknesses
          </div>
          <div className="space-y-4">
            {weaknesses.map((w: string, i: number) => (
              <div key={i} className="text-[11px] text-neutral-400 leading-snug">
                <span className="text-red-500 font-bold mr-1.5">FIX:</span> {w}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
