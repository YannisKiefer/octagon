import fs from "fs";
import path from "path";

const CMO_DATA_PATH = path.join(process.cwd(), "..", "data", "cmo", "latest.json");

export interface PhoneStrategy {
  phone: number;
  niche: string;
  directive: string;
  status: "scaling" | "pivot_required" | "stable";
}

export interface CMOData {
  generated_at: string;
  hook_insights: {
    top_hooks: Array<{ pattern: string; reason: string; example_handle?: string }>;
    failing_formats: Array<{ pattern: string; reason: string }>;
    golden_keywords: string[];
    strategic_directive: string;
  };
  forgery_insights: {
    best_variation_profile: string;
    winning_parameters: Record<string, string | number>;
    hypothesis: string;
    adjustment_recommendation: string;
  };
  strategy: {
    executive_summary: string;
    phone_strategies: PhoneStrategy[];
    scraper_bounties: string[];
    ai_confidence_score: string | number;
  };
}

export function getCMOData(): CMOData | null {
  try {
    if (!fs.existsSync(CMO_DATA_PATH)) return null;
    const raw = fs.readFileSync(CMO_DATA_PATH, "utf-8");
    return JSON.parse(raw) as CMOData;
  } catch {
    return null;
  }
}
