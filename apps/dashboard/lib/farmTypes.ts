export type FarmDevice = {
  id: string;
  phone_number: number;
  display_name: string;
  voice_prefix: string;
  usb_udid: string;
  active: number;
  created_at: string;
  updated_at: string;
};

export type FarmDeviceHealth = {
  device_id: string;
  usb_connected: number;
  last_usb_seen_at: string | null;
  session_state: string;
  current_task_id: string;
  swipes: number;
  likes: number;
  saves: number;
  comments: number;
  profiles: number;
  last_action: string;
  last_action_at: string | null;
  jitter_variance: number;
  error: string;
  updated_at: string;
};

export type FarmTaskType = "warmup" | "post" | "audit" | "smoke" | "dm" | "outreach" | "scout" | "scroll";
export type FarmTaskStatus = "scheduled" | "running" | "succeeded" | "failed" | "canceled";

export type FarmTask = {
  id: string;
  type: FarmTaskType;
  device_id: string | null;
  scheduled_for: string;
  status: FarmTaskStatus;
  payload: string;
  started_at: string | null;
  finished_at: string | null;
  result: string;
  error: string;
  created_at: string;
  updated_at: string;
};

export type EcomBrainTemplate = {
  id: string;
  name: string;
  description: string;
  taskType: FarmTaskType;
  icon: string;
  color: string;
  defaultPayload: Record<string, unknown>;
  estimatedMinutes: number;
};

export const FARM_TEMPLATES: EcomBrainTemplate[] = [
  {
    id: "warmup-standard",
    name: "Standard Warmup",
    description: "Scroll, like, save, and comment to warm up account signals.",
    taskType: "warmup",
    icon: "magic_button",
    color: "blue",
    defaultPayload: { duration_minutes: 30, platform: "tiktok", actions: ["scroll", "like", "save", "comment"] },
    estimatedMinutes: 30,
  },
  {
    id: "warmup-aggressive",
    name: "Aggressive Warmup",
    description: "High-frequency engagement for rapid trust score improvement.",
    taskType: "warmup",
    icon: "bolt",
    color: "orange",
    defaultPayload: { duration_minutes: 60, platform: "tiktok", actions: ["scroll", "like", "save", "comment", "profile"], aggressive: true },
    estimatedMinutes: 60,
  },
  {
    id: "scrape-niche",
    name: "Niche Scraper",
    description: "Discover and download top-performing content from competitor accounts.",
    taskType: "scout",
    icon: "travel_explore",
    color: "green",
    defaultPayload: { max_videos: 20, min_views: 10000, sort_by: "engagement" },
    estimatedMinutes: 15,
  },
  {
    id: "outreach-dm",
    name: "DM Outreach",
    description: "Send personalized DMs to qualified leads from scouted communities.",
    taskType: "outreach",
    icon: "chat",
    color: "purple",
    defaultPayload: { max_dms: 10, delay_between_ms: 45000, template: "default" },
    estimatedMinutes: 20,
  },
  {
    id: "post-content",
    name: "Content Post",
    description: "Post a forged video variation with optimal timing and caption.",
    taskType: "post",
    icon: "upload",
    color: "red",
    defaultPayload: { platform: "tiktok", use_organic_window: true },
    estimatedMinutes: 5,
  },
  {
    id: "audit-parity",
    name: "Parity Audit",
    description: "Run behavioral parity scoring to verify human-like patterns.",
    taskType: "audit",
    icon: "verified_user",
    color: "teal",
    defaultPayload: { check_jitter: true, check_timing: true, check_ratios: true },
    estimatedMinutes: 5,
  },
];

// backwards compat
export const ECOM_BRAIN_TEMPLATES = FARM_TEMPLATES;
