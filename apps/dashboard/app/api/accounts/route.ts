import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH =
  process.env.OCTRAGON_DB_PATH ||
  path.resolve(process.cwd(), "..", "..", "infra", "db", "farm.db");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getDb(): Database.Database | null {
  try {
    if (!fs.existsSync(DB_PATH)) return null;
    return new Database(DB_PATH, { readonly: true });
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const db = getDb();
    if (!db) {
      return NextResponse.json({ accounts: [] });
    }

    const accounts = db
      .prepare(
        `SELECT a.*,
          (SELECT COUNT(*) FROM scraped_content sc WHERE sc.target_phone = a.phone_number) as total_scraped,
          (SELECT COUNT(*) FROM delivery_log dl WHERE dl.phone_number = a.phone_number AND dl.approval_status = 'posted') as total_posted,
          (SELECT COUNT(*) FROM content_analysis ca WHERE ca.account_id = a.id) as total_analyzed
        FROM accounts a
        WHERE a.active = 1
        ORDER BY a.phone_number, a.platform`
      )
      .all();

    const accountsWithDNA = (accounts as Record<string, unknown>[]).map((acct) => {
      let dna: Record<string, unknown> | undefined;
      try {
        dna = db
          .prepare("SELECT * FROM viral_dna_profile WHERE account_id = ?")
          .get(acct.id as string) as Record<string, unknown> | undefined;
      } catch {}

      let nextPosts: any[] = [];
      try {
        nextPosts = db
          .prepare(
            "SELECT * FROM next_post_queue WHERE account_id = ? AND status = 'queued' ORDER BY priority ASC LIMIT 3"
          )
          .all(acct.id as string);
      } catch {}

      let recentAnalyses: any[] = [];
      try {
        recentAnalyses = db
          .prepare(
            `SELECT ca.verdict, ca.cmo_score, ca.why_worked, ca.why_failed, ca.hook_type,
                    sc.caption, sc.engagement_views, sc.source_creator
             FROM content_analysis ca
             JOIN scraped_content sc ON ca.scraped_content_id = sc.id
             WHERE ca.account_id = ?
             ORDER BY ca.generated_at DESC LIMIT 5`
          )
          .all(acct.id as string);
      } catch {}

      return {
        ...acct,
        viral_dna: dna
          ? {
              ...dna,
              top_hooks: safeJsonParse(dna.top_hooks as string, []),
              winning_formats: safeJsonParse(dna.winning_formats as string, []),
              winning_emotions: safeJsonParse(dna.winning_emotions as string, []),
              optimal_posting_times: safeJsonParse(dna.optimal_posting_times as string, []),
            }
          : null,
        next_posts: nextPosts,
        recent_analyses: recentAnalyses,
      };
    });

    db.close();
    return NextResponse.json({ accounts: accountsWithDNA });
  } catch (e: any) {
    return NextResponse.json({ accounts: [], error: e?.message || String(e) }, { status: 500 });
  }
}

function safeJsonParse(val: string | undefined | null, fallback: any): any {
  if (!val) return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}
