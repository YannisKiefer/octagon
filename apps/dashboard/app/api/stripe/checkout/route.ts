import { NextResponse } from "next/server";
import { TIER_CONFIGS, Tier } from "@/lib/tiers";
import { getOrCreateSubscription, getDefaultUserId } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return NextResponse.json(
        { error: "Stripe is not configured. Please add STRIPE_SECRET_KEY." },
        { status: 503 }
      );
    }

    const body = await request.json();
    const tier = (body.tier as Tier) || "solo";

    if (!TIER_CONFIGS[tier]) {
      return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
    }

    const tierConfig = TIER_CONFIGS[tier];
    const priceId = tierConfig.priceId;

    if (!priceId || priceId.includes("placeholder")) {
      return NextResponse.json(
        { error: "Stripe price IDs are not configured. Please set STRIPE_PRICE_SOLO, STRIPE_PRICE_STUDIO, STRIPE_PRICE_ENTERPRISE." },
        { status: 503 }
      );
    }

    const userId = getDefaultUserId();
    const sub = getOrCreateSubscription(userId, body.email || "");

    const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_URL || "http://localhost:5000";

    const checkoutBody: Record<string, any> = {
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/onboarding?session_id={CHECKOUT_SESSION_ID}&tier=${tier}`,
      cancel_url: `${origin}/landing?canceled=true`,
      metadata: { user_id: userId, tier },
      allow_promotion_codes: true,
    };

    if (sub.stripe_customer_id) {
      checkoutBody.customer = sub.stripe_customer_id;
    } else if (body.email) {
      checkoutBody.customer_email = body.email;
    }

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(flattenStripeParams(checkoutBody)).toString(),
    });

    const session = await response.json();

    if (!response.ok) {
      return NextResponse.json({ error: session.error?.message || "Stripe error" }, { status: 400 });
    }

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function flattenStripeParams(obj: Record<string, any>, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === "object" && item !== null) {
          Object.assign(result, flattenStripeParams(item, `${fullKey}[${i}]`));
        } else {
          result[`${fullKey}[${i}]`] = String(item);
        }
      });
    } else if (typeof value === "object" && value !== null) {
      Object.assign(result, flattenStripeParams(value, fullKey));
    } else if (value !== undefined && value !== null) {
      result[fullKey] = String(value);
    }
  }
  return result;
}
