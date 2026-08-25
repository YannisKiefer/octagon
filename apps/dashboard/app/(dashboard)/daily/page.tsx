export const dynamic = "force-dynamic";

import React from "react";
import { supabase } from "@/lib/supabase";
import { CalendarCheck, Clock, Instagram, PlaySquare, Smartphone, CheckCircle2 } from "lucide-react";

export const revalidate = 0;

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  tiktok: <PlaySquare size={14} />,
  instagram: <Instagram size={14} />,
};

function StatusBadge({ status }: { status: string }) {
  if (status === "posted") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] uppercase font-bold tracking-wider bg-emerald-50 text-emerald-700">
        <CheckCircle2 size={10} /> {status}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] uppercase font-bold tracking-wider bg-[var(--surface-container-high)] text-[var(--secondary)]">
      <Clock size={10} /> {status}
    </span>
  );
}

export default async function DailyPostingQueuePage() {
  const today = new Date().toISOString().split('T')[0];

  const { data: queue, error } = await supabase
    .from("posting_queue")
    .select("*, accounts(display_name, platform, handle)")
    .eq("date", today)
    .order("time_slot", { ascending: true })
    .order("priority", { ascending: true });

  if (error) {
    console.error("Error fetching queue:", error);
  }

  const posts = queue || [];
  const queued = posts.filter((p) => p.status === "queued");
  const posted = posts.filter((p) => p.status === "posted");

  const byAccount: Record<string, any[]> = {};
  for (const post of posts) {
    const accId = post.account_id;
    if (!byAccount[accId]) byAccount[accId] = [];
    byAccount[accId].push(post);
  }

  return (
    <div className="max-w-[1100px] mx-auto space-y-8">
      <div>
        <span className="text-xs font-bold text-[var(--primary)] tracking-widest uppercase mb-2 block">Schedule</span>
        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--on-surface)] flex items-center gap-3">
          Daily Posting Queue
        </h1>
        <p className="text-sm text-[var(--on-surface-variant)] mt-1">
          {posts.length} posts scheduled for today &middot; {posted.length} posted &middot; {queued.length} queued
        </p>
      </div>

      {posts.length === 0 ? (
        <div className="bg-[var(--surface-container-lowest)] rounded-[2rem] py-16 text-center flex flex-col items-center justify-center shadow-sm">
          <span className="material-symbols-outlined text-5xl text-[var(--outline-variant)] mb-6">calendar_month</span>
          <h3 className="text-xl font-bold text-[var(--on-surface)] mb-2">Queue is empty</h3>
          <p className="text-sm text-[var(--secondary)] max-w-md mx-auto leading-relaxed">
            Run the <code className="bg-[var(--surface-container-high)] px-1.5 py-0.5 rounded text-xs">/daily</code> command in your Telegram group to generate today&rsquo;s posting schedule.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {Object.entries(byAccount).map(([accountId, accountPosts]) => {
            const first = accountPosts[0];
            const accInfo = first.accounts || {};
            
            return (
              <div key={accountId} className="bg-[var(--surface-container-lowest)] rounded-2xl overflow-hidden shadow-sm border border-[var(--outline-variant)]/10">
                <div className="flex items-center justify-between px-5 py-3.5 bg-[var(--surface-container-low)]">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center text-[var(--primary)]">
                      {PLATFORM_ICONS[accInfo.platform] || <Smartphone size={14} />}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-[var(--on-surface)]">{accInfo.display_name || "Unknown Account"}</div>
                      <div className="text-xs text-[var(--secondary)] mt-0.5 tracking-wide">@{accInfo.handle || accountId}</div>
                    </div>
                  </div>
                  <div className="text-xs text-[var(--secondary)] font-medium">
                    {accountPosts.filter(p => p.status === "posted").length} / {accountPosts.length} Posted
                  </div>
                </div>

                <div>
                  {accountPosts.map((post, i) => (
                    <div 
                      key={post.id} 
                      className={`flex items-start gap-4 p-4 ${i < accountPosts.length - 1 ? "border-b border-[var(--outline-variant)]/10" : ""}`}
                    >
                      <div className="w-16 shrink-0 pt-0.5">
                        <div className="text-sm font-bold text-[var(--on-surface)]">{post.time_slot}</div>
                        {post.priority < 5 && (
                          <div className="text-[9px] uppercase tracking-widest text-amber-600 font-bold mt-1">
                            High Prio
                          </div>
                        )}
                        {post.cross_platform_source && (
                          <div className="text-[9px] uppercase tracking-widest text-[var(--primary)] font-bold mt-1">
                            Cross-Post
                          </div>
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-[var(--on-surface)] line-clamp-2 leading-relaxed">
                          {post.caption || <span className="text-[var(--outline)] italic">No caption generated</span>}
                        </div>
                        {post.music_url && (
                          <div className="text-xs text-[var(--secondary)] mt-2 flex items-center gap-1.5 truncate">
                            <span className="text-[10px] bg-[var(--surface-container-high)] text-[var(--secondary)] px-1.5 py-0.5 rounded">AUDIO</span>
                            {post.music_url}
                          </div>
                        )}
                      </div>
                      
                      <div className="shrink-0 pt-0.5">
                        <StatusBadge status={post.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
