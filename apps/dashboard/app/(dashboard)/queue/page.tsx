export const dynamic = "force-dynamic";

import { getRecentScraped, getVariations } from "@/lib/db";
import { VideoThumb } from "@/components/VideoThumb";
import { PlaySquare, Instagram, Linkedin, Twitter, Smartphone, Inbox, CheckCircle2, Clock, XCircle, AlertCircle } from "lucide-react";

function getPlatformIcon(platform: string, size = 16) {
  switch (platform.toLowerCase()) {
    case 'instagram': return <Instagram size={size} />;
    case 'linkedin': return <Linkedin size={size} />;
    case 'twitter':
    case 'x': return <Twitter size={size} />;
    case 'tiktok': return <PlaySquare size={size} />;
    default: return <Smartphone size={size} />;
  }
}

function StatusBadge({ status }: { status: string }) {
  if (status === "downloaded" || status === "done") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] uppercase font-bold tracking-wider bg-emerald-50 text-emerald-700">
        <CheckCircle2 size={10} /> {status}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] uppercase font-bold tracking-wider bg-red-50 text-red-700">
        <XCircle size={10} /> {status}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] uppercase font-bold tracking-wider bg-[var(--surface-container-high)] text-[var(--secondary)]">
      <Clock size={10} /> {status}
    </span>
  );
}

export default function QueuePage() {
  const scraped = getRecentScraped(40);

  return (
    <div className="max-w-[1100px] mx-auto space-y-8">
      <div>
        <span className="text-xs font-bold text-[var(--primary)] tracking-widest uppercase mb-2 block">Content Pipeline</span>
        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--on-surface)] flex items-center gap-3">
          Scraper Feed
        </h1>
        <p className="text-sm text-[var(--on-surface-variant)] mt-1">
          All scraped videos and their generated variations
        </p>
      </div>

      {scraped.length === 0 ? (
        <div className="bg-[var(--surface-container-lowest)] rounded-[2rem] py-16 text-center flex flex-col items-center justify-center shadow-sm">
          <Inbox size={48} className="text-[var(--outline-variant)] mb-6" />
          <h3 className="text-xl font-bold text-[var(--on-surface)] mb-2">Nothing scraped yet</h3>
          <p className="text-sm text-[var(--secondary)] max-w-md mx-auto leading-relaxed">
            Drop a TikTok, Instagram, or LinkedIn video URL in one of your Telegram groups to start.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {scraped.map(sc => {
            const variations = getVariations(sc.id);
            return (
              <div key={sc.id} className="bg-[var(--surface-container-lowest)] rounded-2xl overflow-hidden shadow-sm border border-[var(--outline-variant)]/10">
                <div className={`flex items-center gap-4 px-5 py-3.5 bg-[var(--surface-container-low)] ${variations.length ? "border-b border-[var(--outline-variant)]/10" : ""}`}>
                  <div className="w-8 h-8 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center text-[var(--primary)] shrink-0">
                    {getPlatformIcon(sc.source_platform, 14)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-[var(--on-surface)] truncate">
                      {sc.source_creator ? `@${sc.source_creator}` : sc.source_url.slice(0, 60) + "\u2026"}
                    </div>
                    <div className="text-xs text-[var(--secondary)] mt-0.5 font-medium tracking-wide">
                      <span className="capitalize">{sc.source_platform}</span> <span className="mx-1 text-[var(--outline-variant)]">&bull;</span> {sc.duration_seconds}s <span className="mx-1 text-[var(--outline-variant)]">&bull;</span> {sc.engagement_views.toLocaleString()} views
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-[11px] font-bold text-[var(--on-surface)]">Phone {sc.target_phone}</div>
                      <div className="text-[10px] text-[var(--secondary)] uppercase tracking-widest mt-0.5">{sc.target_niche}</div>
                    </div>
                    <StatusBadge status={sc.scrape_status} />
                  </div>
                </div>

                {variations.length > 0 && (
                  <div className="p-5">
                    <div className="text-[10px] text-[var(--secondary)] uppercase tracking-widest font-bold mb-3 flex items-center gap-2">
                      <AlertCircle size={12} className="text-[var(--outline)]" />
                      {variations.length} variation{variations.length > 1 ? "s" : ""}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {variations.map(v => {
                        const label = ["A", "B", "C"][v.variation_index] ?? v.variation_index;
                        const analysis = (() => { try { return JSON.parse(v.gemini_analysis); } catch { return {}; } })();
                        return (
                          <div key={v.id} className="bg-[var(--surface-container-low)] rounded-xl overflow-hidden min-w-[180px] flex-1 max-w-[280px]">
                            {v.video_path && (
                              <VideoThumb
                                src={`/api/video/thumb?path=${encodeURIComponent(v.video_path.replace(/^.*\/videos\//, ""))}`}
                                label={label as string}
                              />
                            )}
                            <div className="p-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-bold text-[var(--on-surface)]">Variation {label}</span>
                                <StatusBadge status={v.cleanse_status} />
                              </div>
                              <div className="text-[10px] text-[var(--secondary)] font-mono mb-2 bg-[var(--surface-container-highest)] px-2 py-1 rounded inline-block">
                                {v.video_hash.slice(0, 12)}\u2026
                              </div>
                              {analysis.quality_score && (
                                <div className="text-[10px] text-[var(--secondary)] mt-1 tracking-wide leading-snug">
                                  <span className="text-[var(--outline)]">Gemini:</span> {analysis.quality_score}/100 <span className="mx-1 text-[var(--outline-variant)]">&bull;</span> {analysis.content_type}
                                </div>
                              )}
                              {v.metadata_injected ? (
                                <div className="text-[10px] text-emerald-600 mt-2 font-bold flex items-center gap-1">
                                  <CheckCircle2 size={10} /> Metadata Injected
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
