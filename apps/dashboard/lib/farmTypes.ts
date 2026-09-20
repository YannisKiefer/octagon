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

// Only task types the farm brain actually executes. Anything else is rejected
// at the API and, if it ever reaches the brain, fails honestly instead of
// being marked done.
export type FarmTaskType = "session";
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
