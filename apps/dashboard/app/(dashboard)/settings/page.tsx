export const dynamic = "force-dynamic";

import { getNicheConfigs } from "@/lib/db";
import { Settings, Phone, MessageCircle, Hash, Database as DbIcon } from "lucide-react";

export default function SettingsPage() {
  const niches = getNicheConfigs();

  return (
    <div className="max-w-[800px] mx-auto space-y-10">
      <div>
        <span className="text-xs font-bold text-[var(--primary)] tracking-widest uppercase mb-2 block">Configuration</span>
        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--on-surface)] flex items-center gap-3">
          Settings
        </h1>
        <p className="text-sm text-[var(--on-surface-variant)] mt-1">
          Niche configuration and pipeline parameters
        </p>
      </div>

      {/* Niche configs */}
      <div>
        <div className="flex items-center gap-2 text-xs text-[var(--secondary)] uppercase tracking-widest font-bold mb-4">
          <Phone size={14} className="text-[var(--primary)]" />
          Phone Configuration
        </div>
        <div className="flex flex-col gap-4">
          {niches.map(nc => {
            const platforms: string[] = (() => { try { return JSON.parse(nc.platforms); } catch { return []; } })();
            return (
              <div key={nc.phone_number} className="bg-[var(--surface-container-lowest)] rounded-2xl p-5 shadow-sm border border-[var(--outline-variant)]/10">
                <div className="flex items-center gap-3 mb-5 pb-4 border-b border-[var(--outline-variant)]/20">
                  <div className="w-8 h-8 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center text-[var(--primary)]">
                    <Hash size={14} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-[var(--on-surface)] leading-none">Phone {nc.phone_number}</div>
                    <div className="text-[11px] text-[var(--secondary)] font-medium mt-1.5 uppercase tracking-wide">{nc.niche_name}</div>
                  </div>
                  <div className="ml-auto">
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-[10px] uppercase font-bold tracking-wider
                      ${nc.active ? "bg-emerald-50 text-emerald-700" : "bg-[var(--surface-container-high)] text-[var(--secondary)]"}
                    `}>
                      {nc.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                  <div>
                    <div className="text-[10px] text-[var(--secondary)] uppercase tracking-widest font-bold mb-1.5">Telegram Group</div>
                    <div className="text-xs text-[var(--on-surface)] font-mono bg-[var(--surface-container-high)] px-2 py-1.5 rounded-lg inline-block">{nc.telegram_group_id}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--secondary)] uppercase tracking-widest font-bold mb-1.5">Platforms</div>
                    <div className="flex flex-wrap gap-2">
                      {platforms.map(p => (
                        <span key={p} className="inline-flex items-center px-2.5 py-1 rounded-full bg-[var(--primary-fixed)] text-[var(--on-primary-fixed)] text-[10px] font-bold tracking-wider uppercase">
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                  
                  {nc.tiktok_handle && (
                    <div>
                      <div className="text-[10px] text-[var(--secondary)] uppercase tracking-widest font-bold mb-1.5">TikTok</div>
                      <div className="text-xs text-[var(--on-surface)] font-medium">@{nc.tiktok_handle}</div>
                    </div>
                  )}
                  {nc.instagram_handle && (
                    <div>
                      <div className="text-[10px] text-[var(--secondary)] uppercase tracking-widest font-bold mb-1.5">Instagram</div>
                      <div className="text-xs text-[var(--on-surface)] font-medium">@{nc.instagram_handle}</div>
                    </div>
                  )}
                  {nc.linkedin_handle && (
                    <div>
                      <div className="text-[10px] text-[var(--secondary)] uppercase tracking-widest font-bold mb-1.5">LinkedIn</div>
                      <div className="text-xs text-[var(--on-surface)] font-medium">{nc.linkedin_handle}</div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pipeline config */}
      <div>
        <div className="flex items-center gap-2 text-xs text-[var(--secondary)] uppercase tracking-widest font-bold mb-4">
          <DbIcon size={14} className="text-[var(--primary)]" />
          Pipeline Parameters
        </div>
        <div className="bg-[var(--surface-container-lowest)] rounded-2xl overflow-hidden shadow-sm border border-[var(--outline-variant)]/10">
          {[
            { label: "Forgery Layers", value: "5 (fps + crop + audio pitch + re-encode + noise)" },
            { label: "Variations Per Video", value: "3 (A, B, C with unique hash seeds)" },
            { label: "Gemini Vision Model", value: "gemini-3.1-pro-preview" },
            { label: "Metadata Device Profile", value: "iPhone 15 Pro / 15 Pro Max / 16 Pro" },
            { label: "GPS Randomization", value: "\u00b10.01\u00b0 from center coordinate" },
            { label: "Audio Pitch Range", value: "+2%, \u22121.5%, +3% per variation" },
            { label: "Database", value: "SQLite (WAL mode) \u2014 octragon.db" },
          ].map((row, i) => (
            <div key={i} className="flex justify-between items-center p-4 hover:bg-[var(--surface-container-low)] transition-colors border-b border-[var(--outline-variant)]/10 last:border-b-0">
              <span className="text-xs font-semibold text-[var(--on-surface)] tracking-wide">{row.label}</span>
              <span className="text-xs font-mono text-[var(--secondary)] text-right max-w-[320px]">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
