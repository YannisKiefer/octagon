/**
 * Agents Data Layer — God-Mode Dashboard
 *
 * Reads flat files (JSON, TXT, flag files) from all agent team directories
 * to provide unified stats, activity logs, and status for:
 *   - Skool (DM outreach)
 *   - Whop (DM outreach)
 *   - Twitter (content + outreach)
 *   - Octragon (video pipeline — already in db.ts)
 */
import fs from "fs";
import path from "path";
import os from "os";

// ── Paths ──────────────────────────────────────────────────────────────────

const HOME = os.homedir();
const SKOOL_DATA = path.join(HOME, "clawd/brain/skool-whop-team/data");
const WHOP_DATA = path.join(HOME, "clawd/brain/whop-team/data");
const TWITTER_AGENTS = path.join(HOME, "clawd/brain/fleet-backup/agents");
const CRM_LOG = path.join(HOME, "clawd/crm/contact_log.json");

// ── Types ──────────────────────────────────────────────────────────────────

export type AgentTeam = "skool" | "whop" | "twitter" | "octragon";

export type AgentStatus = "running" | "paused" | "error" | "unknown";

export type ContactedEntry = {
  date: string;
  slug: string;
  displayName: string;
  owner: string;
  status: string;
  platform: AgentTeam;
};

export type AgentStats = {
  team: AgentTeam;
  label: string;
  status: AgentStatus;
  dmsSentToday: number;
  dmsSentTotal: number;
  leadsReady: number;
  leadsTotal: number;
  repliesCount: number;
  lastActivity: string | null;
  flagPath: string;
};

export type CrmEntry = {
  username: string;
  platform: string;
  communitySlug: string;
  displayName: string;
  messagePreview: string;
  sentAt: string;
  status: string;
};

export type TwitterAgentInfo = {
  name: string;
  filename: string;
  lastModified: string;
  category: "content" | "outreach" | "signal";
  account: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function readFileIfExists(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function readJsonIfExists<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function flagExists(flagPath: string): boolean {
  return fs.existsSync(flagPath);
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseContactedTxt(
  filePath: string,
  platform: AgentTeam
): ContactedEntry[] {
  const content = readFileIfExists(filePath);
  if (!content) return [];

  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const parts = line.split("|").map((p) => p.trim());
      return {
        date: parts[0] || "",
        slug: parts[1] || "",
        displayName: parts[2] || parts[1] || "",
        owner: parts[3] || "",
        status: parts[parts.length - 1] || "",
        platform,
      };
    });
}

function getLastModified(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    return stat.mtime.toISOString();
  } catch {
    return null;
  }
}

// ── Skool ──────────────────────────────────────────────────────────────────

export function getSkoolStats(): AgentStats {
  const flagPath = path.join(SKOOL_DATA, "DM_STOP.flag");
  const contacted = parseContactedTxt(
    path.join(SKOOL_DATA, "contacted.txt"),
    "skool"
  );
  const approved = readJsonIfExists<any[]>(
    path.join(SKOOL_DATA, "approved-queue.json"),
    []
  );
  const contactedSlugs = new Set(contacted.map((c) => c.slug));
  const today = getToday();

  const dmsSentToday = contacted.filter((c) =>
    c.date.startsWith(today)
  ).length;
  const leadsReady = approved.filter(
    (a) => !contactedSlugs.has(a.slug)
  ).length;

  // Find last activity
  const lastEntry = contacted[contacted.length - 1];
  const lastActivity = lastEntry?.date || null;

  return {
    team: "skool",
    label: "Skool Outreach",
    status: flagExists(flagPath) ? "paused" : "running",
    dmsSentToday,
    dmsSentTotal: contacted.length,
    leadsReady,
    leadsTotal: approved.length,
    repliesCount: 0, // replies need browser session — shown as 0 in dashboard
    lastActivity,
    flagPath,
  };
}

export function getSkoolActivity(limit = 20): ContactedEntry[] {
  return parseContactedTxt(
    path.join(SKOOL_DATA, "contacted.txt"),
    "skool"
  ).slice(-limit).reverse();
}

// ── Whop ──────────────────────────────────────────────────────────────────

export function getWhopStats(): AgentStats {
  const flagPath = path.join(WHOP_DATA, "DM_STOP.flag");
  const contacted = parseContactedTxt(
    path.join(WHOP_DATA, "whop-contacted.txt"),
    "whop"
  );
  const approved = readJsonIfExists<any[]>(
    path.join(WHOP_DATA, "whop-approved-queue.json"),
    []
  );
  const contactedSlugs = new Set(contacted.map((c) => c.slug));
  const today = getToday();

  const dmsSentToday = contacted.filter((c) =>
    c.date.startsWith(today)
  ).length;
  const leadsReady = approved.filter(
    (a) => !contactedSlugs.has(a.slug)
  ).length;

  const lastEntry = contacted[contacted.length - 1];

  return {
    team: "whop",
    label: "Whop Outreach",
    status: flagExists(flagPath) ? "paused" : "running",
    dmsSentToday,
    dmsSentTotal: contacted.length,
    leadsReady,
    leadsTotal: approved.length,
    repliesCount: 0,
    lastActivity: lastEntry?.date || null,
    flagPath,
  };
}

export function getWhopActivity(limit = 20): ContactedEntry[] {
  return parseContactedTxt(
    path.join(WHOP_DATA, "whop-contacted.txt"),
    "whop"
  ).slice(-limit).reverse();
}

// ── Twitter ───────────────────────────────────────────────────────────────

export function getTwitterStats(): AgentStats {
  const agents = getTwitterAgents();
  const lastMod = agents
    .map((a) => a.lastModified)
    .filter(Boolean)
    .sort()
    .pop();

  // Count agents by category
  const contentAgents = agents.filter((a) => a.category === "content").length;
  const outreachAgents = agents.filter((a) => a.category === "outreach").length;
  const signalAgents = agents.filter((a) => a.category === "signal").length;

  return {
    team: "twitter",
    label: "Twitter Automation",
    status: agents.length > 0 ? "running" : "unknown",
    dmsSentToday: outreachAgents, // repurpose: outreach agents active
    dmsSentTotal: agents.length,
    leadsReady: contentAgents, // repurpose: content agents count
    leadsTotal: signalAgents, // repurpose: signal agents count
    repliesCount: 0,
    lastActivity: lastMod || null,
    flagPath: "", // no stop flag for Twitter
  };
}

export function getTwitterAgents(): TwitterAgentInfo[] {
  try {
    const files = fs
      .readdirSync(TWITTER_AGENTS)
      .filter((f) => f.startsWith("twitter-") && f.endsWith(".md"));

    return files.map((filename) => {
      const fullPath = path.join(TWITTER_AGENTS, filename);
      const lastModified = getLastModified(fullPath) || "";

      let category: "content" | "outreach" | "signal" = "signal";
      if (filename.includes("content")) category = "content";
      else if (filename.includes("outreach")) category = "outreach";

      let account = "unknown";
      if (filename.includes("-eb")) account = "ecombrain";
      else if (filename.includes("-yk")) account = "yannis";

      // Clean up name
      const name = filename
        .replace(".md", "")
        .replace(/__[a-f0-9]+$/, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      return { name, filename, lastModified, category, account };
    });
  } catch {
    return [];
  }
}

// ── CRM (Cross-Platform) ─────────────────────────────────────────────────

export function getCrmLog(limit = 30): CrmEntry[] {
  const log = readJsonIfExists<{ entries: any[] }>(CRM_LOG, { entries: [] });
  return log.entries
    .map((e: any) => ({
      username: e.username || "",
      platform: e.platform || "unknown",
      communitySlug: e.community_slug || "",
      displayName: e.display_name || "",
      messagePreview: e.message_preview || "",
      sentAt: e.sent_at || "",
      status: e.status || "sent",
    }))
    .reverse()
    .slice(0, limit);
}

// ── Unified ───────────────────────────────────────────────────────────────

export function getAllAgentStats(): AgentStats[] {
  return [getSkoolStats(), getWhopStats(), getTwitterStats()];
}

export function getUnifiedActivity(limit = 30): ContactedEntry[] {
  const skool = getSkoolActivity(limit);
  const whop = getWhopActivity(limit);
  return [...skool, ...whop]
    .sort((a, b) => (b.date > a.date ? 1 : -1))
    .slice(0, limit);
}

export function toggleAgent(
  team: AgentTeam,
  action: "start" | "stop"
): { success: boolean; message: string } {
  let flagPath = "";
  if (team === "skool") flagPath = path.join(SKOOL_DATA, "DM_STOP.flag");
  else if (team === "whop") flagPath = path.join(WHOP_DATA, "DM_STOP.flag");
  else {
    return { success: false, message: `Toggle not supported for ${team}` };
  }

  try {
    if (action === "stop") {
      fs.writeFileSync(flagPath, `Paused by dashboard at ${new Date().toISOString()}\n`);
      return { success: true, message: `${team} DMs paused (flag created)` };
    } else {
      if (fs.existsSync(flagPath)) fs.unlinkSync(flagPath);
      return { success: true, message: `${team} DMs resumed (flag removed)` };
    }
  } catch (e: any) {
    return { success: false, message: `Failed: ${e.message}` };
  }
}
