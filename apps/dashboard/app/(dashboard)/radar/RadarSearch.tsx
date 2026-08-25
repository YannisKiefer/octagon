"use client";

import { useState, useRef } from "react";

type SearchResult = {
  content_id: string;
  score: number;
  search_mode: string;
  source_url: string;
  source_platform: string;
  source_creator: string;
  caption: string;
  hashtags: string;
  engagement_views: number;
  engagement_likes: number;
  engagement_comments: number;
  duration_seconds: number;
  target_niche: string;
};

const PLATFORM_GLYPHS: Record<string, string> = {
  tiktok: "TT",
  instagram: "IG",
  linkedin: "LI",
  twitter: "TW",
  youtube: "YT",
};

export default function RadarSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=12`);
      const data = await res.json();
      setResults(data.results ?? []);
      setMode(data.mode ?? null);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(val), 420);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    runSearch(query);
  };

  return (
    <div className="space-y-8">
      <form onSubmit={handleSubmit} className="relative">
        <div className="flex items-center gap-4 bg-[var(--surface-container-lowest)] rounded-2xl px-6 py-4 shadow-sm border border-[var(--outline-variant)]/10">
          <span className="font-mono text-[10px] text-[var(--secondary)] uppercase tracking-widest whitespace-nowrap">
            SCAN_VECTOR
          </span>
          <input
            type="text"
            value={query}
            onChange={handleChange}
            placeholder="Search viral content by theme, hook, or creator..."
            className="flex-1 bg-transparent text-[var(--on-surface)] font-mono text-sm placeholder:text-[var(--outline)] outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          {loading ? (
            <span className="w-4 h-4 border-2 border-[var(--outline-variant)] border-t-[var(--primary)] animate-spin rounded-full" />
          ) : (
            <button
              type="submit"
              className="font-mono text-[9px] text-[var(--secondary)] uppercase tracking-widest hover:text-[var(--primary)] transition-colors"
            >
              EXEC
            </button>
          )}
        </div>
        {mode && (
          <div className="absolute right-2 -bottom-5 font-mono text-[9px] text-[var(--outline)] uppercase tracking-widest">
            mode: {mode}
          </div>
        )}
      </form>

      {searched && (
        <div>
          {results.length === 0 && !loading ? (
            <div className="bg-[var(--surface-container-low)] rounded-2xl p-10 flex flex-col items-center gap-3 text-[var(--outline)]">
              <span className="material-symbols-outlined text-4xl">search_off</span>
              <p className="font-mono text-[10px] uppercase tracking-widest">NO_SIGNAL</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {results.map((r) => (
                <a
                  key={r.content_id}
                  href={r.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group bg-[var(--surface-container-lowest)] rounded-2xl p-6 flex flex-col gap-4 shadow-sm border border-[var(--outline-variant)]/10 hover:shadow-lg transition-all no-underline"
                >
                  <div className="flex justify-between items-start">
                    <div className="min-w-0">
                      <span className="text-[9px] font-mono text-[var(--secondary)] uppercase block mb-1">
                        {PLATFORM_GLYPHS[r.source_platform] ?? r.source_platform.toUpperCase()}
                        {" \u00b7 "}
                        {r.target_niche.toUpperCase()}
                      </span>
                      <p className="text-sm font-bold text-[var(--on-surface)] tracking-tight truncate">
                        @{r.source_creator || "unknown"}
                      </p>
                    </div>
                    <div className="shrink-0 ml-3 text-right">
                      <span className="text-lg font-extrabold text-[var(--primary)]">
                        {(r.score * 100).toFixed(0)}
                      </span>
                      <span className="block text-[8px] font-mono text-[var(--secondary)] mt-0.5 uppercase">
                        MATCH%
                      </span>
                    </div>
                  </div>

                  <div className="h-px w-full bg-[var(--outline-variant)]/20" />

                  <p className="font-mono text-[10px] text-[var(--secondary)] line-clamp-3 leading-relaxed">
                    {r.caption || "(no caption)"}
                  </p>

                  <div className="grid grid-cols-3 gap-2 mt-auto">
                    {[
                      { label: "VIEWS", val: r.engagement_views },
                      { label: "LIKES", val: r.engagement_likes },
                      { label: "CMTS", val: r.engagement_comments },
                    ].map(({ label, val }) => (
                      <div key={label} className="bg-[var(--surface-container-low)] rounded-xl p-2 text-center">
                        <p className="text-[8px] text-[var(--secondary)] uppercase font-black">{label}</p>
                        <p className="text-xs text-[var(--on-surface)] font-mono mt-0.5">
                          {val >= 1_000_000
                            ? `${(val / 1_000_000).toFixed(1)}M`
                            : val >= 1000
                            ? `${(val / 1000).toFixed(1)}K`
                            : String(val)}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[8px] text-[var(--outline)] uppercase">
                      {r.duration_seconds}s
                    </span>
                    <span className="font-mono text-[8px] text-[var(--outline)] group-hover:text-[var(--primary)] transition-colors uppercase tracking-widest">
                      OPEN_SOURCE &rarr;
                    </span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
