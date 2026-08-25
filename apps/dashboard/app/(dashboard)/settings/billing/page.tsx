"use client";

import { useEffect, useState } from "react";
import { CreditCard, Zap, Calendar, TrendingUp } from "lucide-react";
import Link from "next/link";

type SubscriptionData = {
  subscription: {
    tier: string;
    subscription_status: string;
    current_period_end: string | null;
    stripe_customer_id: string | null;
    onboarding_completed: number;
  } | null;
  usage: {
    posts_count: number;
    accounts_count: number;
    phones_count: number;
    date: string;
  };
  tierConfig: {
    name: string;
    price: number;
    phones: number | null;
    accounts: number | null;
    postsPerDay: number | null;
    features: string[];
  };
};

function UsageBar({ label, current, max }: { label: string; current: number; max: number | null }) {
  const pct = max === null ? 0 : Math.min(100, (current / max) * 100);
  const isNearLimit = max !== null && pct > 80;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-center">
        <span className="text-xs font-semibold text-[var(--on-surface)] tracking-wide">{label}</span>
        <span className="text-xs font-mono text-[var(--secondary)]">
          {current} / {max === null ? "\u221e" : max}
        </span>
      </div>
      <div className="h-1.5 bg-[var(--surface-container-highest)] rounded-full overflow-hidden">
        {max !== null && (
          <div
            className={`h-full rounded-full transition-all ${isNearLimit ? "bg-amber-500" : "bg-[var(--primary)]"}`}
            style={{ width: `${pct}%` }}
          />
        )}
        {max === null && (
          <div className="h-full bg-[var(--primary)]/20 w-full rounded-full" />
        )}
      </div>
    </div>
  );
}

const TIER_LABELS: Record<string, string> = {
  solo: "Solo Clipper",
  studio: "Studio",
  enterprise: "Enterprise",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Past Due",
  canceled: "Canceled",
  unpaid: "Unpaid",
};

export default function BillingPage() {
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    fetch("/api/subscription")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleManageBilling() {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const d = await res.json();
      if (d.url) {
        window.location.href = d.url;
      } else {
        alert(d.error || "Failed to open billing portal");
      }
    } catch {
      alert("Failed to connect to billing system");
    } finally {
      setPortalLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-[800px] mx-auto space-y-8">
        <div>
          <span className="text-xs font-bold text-[var(--primary)] tracking-widest uppercase mb-2 block">Subscription</span>
          <h1 className="text-3xl font-extrabold tracking-tight text-[var(--on-surface)] flex items-center gap-3">
            Billing
          </h1>
        </div>
        <div className="text-[var(--secondary)] text-sm">Loading subscription data...</div>
      </div>
    );
  }

  const sub = data?.subscription;
  const usage = data?.usage;
  const tierConfig = data?.tierConfig;
  const tierName = TIER_LABELS[sub?.tier || "solo"] || "Solo Clipper";
  const status = sub?.subscription_status || "trialing";
  const statusLabel = STATUS_LABELS[status] || status;
  const hasStripe = !!sub?.stripe_customer_id;

  const nextBilling = sub?.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="max-w-[800px] mx-auto space-y-8">
      <div>
        <span className="text-xs font-bold text-[var(--primary)] tracking-widest uppercase mb-2 block">Subscription</span>
        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--on-surface)]">
          Billing &amp; Subscription
        </h1>
        <p className="text-sm text-[var(--on-surface-variant)] mt-1">
          Manage your plan and monitor usage limits
        </p>
      </div>

      <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 shadow-sm border border-[var(--outline-variant)]/10">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-[var(--secondary)] mb-2">Current Plan</div>
            <div className="text-2xl font-black text-[var(--on-surface)] uppercase tracking-tight">{tierName}</div>
            <div className="flex items-center gap-3 mt-2">
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] uppercase font-bold tracking-wider
                ${status === "active" || status === "trialing"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
                }
              `}>
                {statusLabel}
              </span>
              {nextBilling && (
                <span className="text-xs text-[var(--secondary)] flex items-center gap-1">
                  <Calendar size={11} />
                  Renews {nextBilling}
                </span>
              )}
              {!nextBilling && status === "trialing" && (
                <span className="text-xs text-[var(--secondary)]">14-day free trial</span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-3 items-end">
            {hasStripe ? (
              <button
                onClick={handleManageBilling}
                disabled={portalLoading}
                className="btn-primary disabled:opacity-50"
              >
                {portalLoading ? "Opening..." : "Manage Billing"}
              </button>
            ) : (
              <Link
                href="/landing#pricing"
                className="btn-primary no-underline"
              >
                Upgrade Plan
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="bg-[var(--surface-container-lowest)] rounded-2xl p-6 shadow-sm border border-[var(--outline-variant)]/10">
        <div className="flex items-center gap-2 text-xs text-[var(--secondary)] uppercase tracking-widest font-bold mb-6">
          <TrendingUp size={14} className="text-[var(--primary)]" />
          Usage Today
        </div>
        <div className="space-y-6">
          <UsageBar
            label="Posts"
            current={usage?.posts_count || 0}
            max={tierConfig?.postsPerDay || null}
          />
          <UsageBar
            label="Accounts"
            current={usage?.accounts_count || 0}
            max={tierConfig?.accounts || null}
          />
          <UsageBar
            label="Phones"
            current={usage?.phones_count || 0}
            max={tierConfig?.phones || null}
          />
        </div>
      </div>

      <div className="bg-[var(--surface-container-lowest)] rounded-2xl overflow-hidden shadow-sm border border-[var(--outline-variant)]/10">
        <div className="flex items-center gap-2 text-xs text-[var(--secondary)] uppercase tracking-widest font-bold p-5 bg-[var(--surface-container-low)]">
          <Zap size={14} className="text-[var(--primary)]" />
          Plan Features
        </div>
        <div>
          {(tierConfig?.features || []).map((feature) => (
            <div key={feature} className="flex items-center gap-3 p-4 border-t border-[var(--outline-variant)]/10 hover:bg-[var(--surface-container-low)] transition-colors">
              <span className="text-[var(--primary)] text-xs">&#9656;</span>
              <span className="text-xs font-medium text-[var(--on-surface)]">{feature}</span>
            </div>
          ))}
        </div>
      </div>

      {!hasStripe && (
        <div className="bg-[var(--surface-container-low)] rounded-2xl p-6">
          <div className="text-xs font-black uppercase tracking-widest text-[var(--on-surface)] mb-2">No Active Subscription</div>
          <p className="text-xs text-[var(--secondary)] mb-4">
            You&apos;re currently using a free trial. Subscribe to a plan to unlock full access and continue using Octragon after your trial ends.
          </p>
          <Link
            href="/landing#pricing"
            className="btn-primary inline-block no-underline"
          >
            Choose a Plan &rarr;
          </Link>
        </div>
      )}
    </div>
  );
}
