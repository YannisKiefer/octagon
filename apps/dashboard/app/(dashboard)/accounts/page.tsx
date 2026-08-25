export const dynamic = "force-dynamic";

import path from "path";
import Database from "better-sqlite3";
import fs from "fs";
import Link from "next/link";

function getDb() {
  const dbPath = path.resolve(process.cwd(), "..", "..", "infra", "db", "octragon.db");
  if (!fs.existsSync(dbPath)) {
    throw new Error(`DB not found at ${dbPath}`);
  }
  return new Database(dbPath, { readonly: true });
}

type AccountRow = {
  id: string;
  phone_number: number;
  platform: string;
  handle: string;
  niche: string;
  display_name: string;
  account_type: string;
  slot_index: number;
  follower_count: number;
  total_scraped: number;
  total_posted: number;
  total_analyzed: number;
  has_dna: number;
  trend_direction: string | null;
  viral_win_count: number;
  next_post_count: number;
};

const NICHE_COLORS: Record<string, string> = {
  ecom: "#F59E0B",
  ai_tech: "#3B82F6",
  business: "#8B5CF6",
  lifestyle: "#22C55E",
};

const PLATFORM_ICONS: Record<string, string> = {
  tiktok: "play_circle",
  instagram: "photo_camera",
  linkedin: "work",
  twitter: "tag",
  youtube: "smart_display",
};

const TREND_ICONS: Record<string, string> = {
  up: "trending_up",
  down: "trending_down",
  neutral: "trending_flat",
};

export default function AccountsPage() {
  const db = getDb();

  const accounts = db.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM scraped_content sc WHERE sc.target_phone = a.phone_number) as total_scraped,
      (SELECT COUNT(*) FROM delivery_log dl WHERE dl.phone_number = a.phone_number AND dl.approval_status = 'posted') as total_posted,
      (SELECT COUNT(*) FROM content_analysis ca WHERE ca.account_id = a.id) as total_analyzed,
      (SELECT COUNT(*) FROM viral_dna_profile vdna WHERE vdna.account_id = a.id) as has_dna,
      (SELECT trend_direction FROM viral_dna_profile vdna WHERE vdna.account_id = a.id) as trend_direction,
      (SELECT viral_win_count FROM viral_dna_profile vdna WHERE vdna.account_id = a.id) as viral_win_count,
      (SELECT COUNT(*) FROM next_post_queue np WHERE np.account_id = a.id AND np.status = 'queued') as next_post_count
    FROM accounts a
    WHERE a.active = 1
    ORDER BY a.phone_number, a.platform
  `).all() as AccountRow[];

  db.close();

  const byPhone: Record<number, AccountRow[]> = {};
  for (const a of accounts) {
    if (!byPhone[a.phone_number]) byPhone[a.phone_number] = [];
    byPhone[a.phone_number].push(a);
  }

  const NICHE_LABELS: Record<string, string> = {
    ecom: "E-commerce",
    ai_tech: "AI / Tech",
    business: "Business",
    lifestyle: "Lifestyle",
  };

  return (
    <div className="max-w-[1100px] mx-auto space-y-8">
      <div>
        <span className="text-xs font-bold text-[var(--primary)] tracking-widest uppercase mb-2 block">Social Profiles</span>
        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--on-surface)]">Accounts</h1>
        <p className="text-sm text-[var(--on-surface-variant)] mt-1">
          {accounts.length} accounts across {Object.keys(byPhone).length} phones
        </p>
      </div>

      {Object.entries(byPhone).map(([phone, accts]) => (
        <div key={phone}>
          <div className="flex items-center gap-3 mb-4">
            <span className="w-3 h-3 rounded-full" style={{ background: NICHE_COLORS[accts[0]?.niche] ?? "#666" }} />
            <span className="text-xs font-bold text-[var(--secondary)] uppercase tracking-widest">
              Phone {phone} &mdash; {NICHE_LABELS[accts[0]?.niche] ?? "Unknown"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {accts.map(acct => (
              <Link key={acct.id} href={`/accounts/${acct.id}`} className="no-underline text-inherit">
                <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-5 shadow-sm border-l-4 hover:shadow-lg transition-all cursor-pointer" style={{ borderLeftColor: NICHE_COLORS[acct.niche] ?? "#666" }}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-[var(--surface-container-high)] flex items-center justify-center">
                        <span className="material-symbols-outlined text-[var(--secondary)] text-lg">{PLATFORM_ICONS[acct.platform] ?? "smartphone"}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-[var(--on-surface)]">{acct.display_name}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                            acct.account_type === "business"
                              ? "bg-blue-50 text-blue-600"
                              : "bg-[var(--surface-container-high)] text-[var(--secondary)]"
                          }`}>{acct.account_type === "business" ? "BIZ" : "PER"}</span>
                        </div>
                        <div className="text-[11px] text-[var(--secondary)]">@{acct.handle}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {acct.has_dna > 0 && (
                        <span className="bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full text-[10px] font-bold">DNA</span>
                      )}
                      {acct.trend_direction && (
                        <span className={`material-symbols-outlined text-lg ${
                          acct.trend_direction === "up" ? "text-emerald-500" :
                          acct.trend_direction === "down" ? "text-red-500" : "text-[var(--secondary)]"
                        }`}>{TREND_ICONS[acct.trend_direction] ?? ""}</span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-0 text-center">
                    {[
                      { label: "Scraped", value: acct.total_scraped },
                      { label: "Posted", value: acct.total_posted },
                      { label: "Analyzed", value: acct.total_analyzed },
                      { label: "Viral", value: acct.viral_win_count ?? 0 },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <div className="text-lg font-black tracking-tight text-[var(--on-surface)]">{value}</div>
                        <div className="text-[9px] text-[var(--outline)] uppercase tracking-widest mt-0.5">{label}</div>
                      </div>
                    ))}
                  </div>

                  {acct.next_post_count > 0 && (
                    <div className="mt-3 px-3 py-2 bg-emerald-50 rounded-xl text-[11px] text-emerald-700 font-medium">
                      {acct.next_post_count} post{acct.next_post_count !== 1 ? "s" : ""} prescribed
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
