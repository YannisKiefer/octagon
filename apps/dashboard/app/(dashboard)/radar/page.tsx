export const dynamic = "force-dynamic";

import React from "react";
import { getAccountWatchlist } from "@/lib/db";
import NodeHeader from "@/components/layout/NodeHeader";
import RadarSearch from "./RadarSearch";

export const revalidate = 0;

export default function RadarPage() {
  const watchlist = getAccountWatchlist();

  return (
    <div className="max-w-7xl mx-auto space-y-12">
      <NodeHeader title="Tracking Radar" status="Monitoring competitor nodes" />

      <div>
        <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--secondary)] mb-4">
          Semantic Search
        </h2>
        <RadarSearch />
      </div>

      <div className="h-px w-full bg-[var(--outline-variant)]/20" />

      <div>
        <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--secondary)] mb-6">
          Tracked Competitor Nodes
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {watchlist.length === 0 ? (
            <div className="col-span-full bg-[var(--surface-container-low)] rounded-[2rem] p-16 flex flex-col items-center justify-center gap-4 text-[var(--outline)]">
              <span className="material-symbols-outlined text-6xl">cloud_off</span>
              <p className="text-sm font-bold">No nodes registered</p>
            </div>
          ) : (
            watchlist.map((account) => (
              <div key={account.handle} className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 flex flex-col gap-4 shadow-sm border border-[var(--outline-variant)]/10 hover:shadow-lg transition-shadow">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-mono text-[var(--outline)] uppercase block mb-1">Node_{account.id}</span>
                    <h3 className="text-xl font-bold text-[var(--on-surface)] tracking-tight">
                      @{account.handle}
                    </h3>
                    <p className="text-[10px] text-[var(--secondary)] uppercase tracking-widest font-bold mt-1">
                      {account.niche}
                    </p>
                  </div>
                  <div className="bg-[var(--primary)] text-white font-black rounded-xl p-2.5 text-center min-w-[48px]">
                    <span className="text-lg leading-none">{account.viral_hit_count}</span>
                    <span className="block text-[8px] mt-0.5 opacity-70">HITS</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[var(--surface-container-low)] p-3 rounded-xl">
                    <p className="text-[9px] text-[var(--secondary)] uppercase font-bold mb-1">Latest Pulse</p>
                    <p className="text-xs text-[var(--on-surface)] font-medium">
                      {account.last_scanned_at ? new Date(account.last_scanned_at).toLocaleDateString() : 'Never'}
                    </p>
                  </div>
                  <div className="bg-[var(--surface-container-low)] p-3 rounded-xl">
                    <p className="text-[9px] text-[var(--secondary)] uppercase font-bold mb-1">Status</p>
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                      <p className="text-xs text-[var(--on-surface)] font-medium uppercase">Synced</p>
                    </div>
                  </div>
                </div>

                <button className="w-full bg-[var(--surface-container-low)] hover:bg-[var(--surface-container-high)] text-[var(--secondary)] hover:text-[var(--primary)] font-semibold uppercase tracking-wider py-3 text-[11px] rounded-xl transition-all">
                  Initialize Handoff
                </button>
              </div>
            ))
          )}
          
          <div className="bg-[var(--surface-container-low)] rounded-2xl p-6 flex flex-col items-center justify-center gap-3 text-[var(--outline)] hover:text-[var(--primary)] transition-colors cursor-pointer h-[280px] border-2 border-dashed border-[var(--outline-variant)]/40">
            <span className="material-symbols-outlined text-5xl">add_circle</span>
            <p className="text-xs font-bold uppercase tracking-wider">Register New Node</p>
          </div>
        </div>
      </div>
    </div>
  );
}
