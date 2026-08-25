export type Tier = "solo" | "studio" | "enterprise";

export type TierConfig = {
  id: Tier;
  name: string;
  price: number;
  priceId: string;
  phones: number | null;
  accounts: number | null;
  postsPerDay: number | null;
  features: string[];
};

export const TIER_CONFIGS: Record<Tier, TierConfig> = {
  solo: {
    id: "solo",
    name: "Solo Clipper",
    price: 49,
    priceId: process.env.STRIPE_PRICE_SOLO || "price_solo_placeholder",
    phones: 1,
    accounts: 3,
    postsPerDay: 50,
    features: [
      "1 phone device",
      "3 social accounts",
      "50 posts per day",
      "AI video forging",
      "CMO intelligence reports",
      "Viral DNA profiling",
    ],
  },
  studio: {
    id: "studio",
    name: "Studio",
    price: 199,
    priceId: process.env.STRIPE_PRICE_STUDIO || "price_studio_placeholder",
    phones: 5,
    accounts: 20,
    postsPerDay: 500,
    features: [
      "5 phone devices",
      "20 social accounts",
      "500 posts per day",
      "Everything in Solo",
      "Priority pipeline processing",
      "Advanced hook analytics",
      "CRM intelligence",
    ],
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    price: 799,
    priceId: process.env.STRIPE_PRICE_ENTERPRISE || "price_enterprise_placeholder",
    phones: null,
    accounts: null,
    postsPerDay: null,
    features: [
      "Unlimited phone devices",
      "Unlimited social accounts",
      "Unlimited posts per day",
      "Everything in Studio",
      "Dedicated account manager",
      "Custom pipeline configuration",
      "SLA guarantee",
    ],
  },
};

export function getTierConfig(tier: Tier): TierConfig {
  return TIER_CONFIGS[tier];
}

export function checkPhoneLimit(tier: Tier, currentPhones: number): boolean {
  const config = TIER_CONFIGS[tier];
  if (config.phones === null) return true;
  return currentPhones < config.phones;
}

export function checkAccountLimit(tier: Tier, currentAccounts: number): boolean {
  const config = TIER_CONFIGS[tier];
  if (config.accounts === null) return true;
  return currentAccounts < config.accounts;
}

export function checkPostsPerDayLimit(tier: Tier, postsToday: number): boolean {
  const config = TIER_CONFIGS[tier];
  if (config.postsPerDay === null) return true;
  return postsToday < config.postsPerDay;
}

export type UsageLimitResult = {
  allowed: boolean;
  reason?: string;
  limit?: number;
  current?: number;
};

export function enforcePhoneLimit(tier: Tier, currentPhones: number): UsageLimitResult {
  const config = TIER_CONFIGS[tier];
  if (config.phones === null) return { allowed: true };
  if (currentPhones >= config.phones) {
    return {
      allowed: false,
      reason: `Your ${config.name} plan allows up to ${config.phones} phone(s). Upgrade to add more.`,
      limit: config.phones,
      current: currentPhones,
    };
  }
  return { allowed: true };
}

export function enforceAccountLimit(tier: Tier, currentAccounts: number): UsageLimitResult {
  const config = TIER_CONFIGS[tier];
  if (config.accounts === null) return { allowed: true };
  if (currentAccounts >= config.accounts) {
    return {
      allowed: false,
      reason: `Your ${config.name} plan allows up to ${config.accounts} account(s). Upgrade to add more.`,
      limit: config.accounts,
      current: currentAccounts,
    };
  }
  return { allowed: true };
}

export function enforcePostsPerDayLimit(tier: Tier, postsToday: number): UsageLimitResult {
  const config = TIER_CONFIGS[tier];
  if (config.postsPerDay === null) return { allowed: true };
  if (postsToday >= config.postsPerDay) {
    return {
      allowed: false,
      reason: `Your ${config.name} plan allows up to ${config.postsPerDay} posts per day. Upgrade for higher limits.`,
      limit: config.postsPerDay,
      current: postsToday,
    };
  }
  return { allowed: true };
}
