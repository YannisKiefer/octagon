import { NextResponse } from "next/server";
import { updateSubscription, updateSubscriptionByStripeCustomer, getOrCreateSubscription } from "@/lib/subscriptions";
import { TIER_CONFIGS, Tier } from "@/lib/tiers";

export const dynamic = "force-dynamic";

function tierFromPriceId(priceId: string): Tier | null {
  for (const [tierId, config] of Object.entries(TIER_CONFIGS)) {
    if (config.priceId === priceId) return tierId as Tier;
  }
  return null;
}

async function verifyStripeSignature(body: string, signature: string, secret: string): Promise<boolean> {
  const parts = signature.split(",");
  const tsPart = parts.find((p) => p.startsWith("t="));
  const v1Part = parts.find((p) => p.startsWith("v1="));
  if (!tsPart || !v1Part) return false;

  const timestamp = tsPart.slice(2);
  const expectedSig = v1Part.slice(3);

  const payload = `${timestamp}.${body}`;
  const enc = new TextEncoder();
  const keyData = enc.encode(secret);
  const msgData = enc.encode(payload);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  const computedHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return computedHex === expectedSig;
}

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await request.text();

  const isValid = await verifyStripeSignature(rawBody, signature, webhookSecret);
  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.metadata?.user_id;
        const tier = (session.metadata?.tier as Tier) || "solo";
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        if (userId) {
          getOrCreateSubscription(userId, session.customer_email || "");
          updateSubscription(userId, {
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            tier,
            subscription_status: "active",
          });
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        const priceId = sub.items?.data?.[0]?.price?.id;
        const tier = tierFromPriceId(priceId) || "solo";
        const periodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;

        updateSubscriptionByStripeCustomer(sub.customer, {
          tier,
          stripe_price_id: priceId,
          stripe_subscription_id: sub.id,
          subscription_status: sub.status,
          current_period_end: periodEnd,
        });
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        updateSubscriptionByStripeCustomer(sub.customer, {
          subscription_status: "canceled",
          stripe_subscription_id: null,
        });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        updateSubscriptionByStripeCustomer(invoice.customer, {
          subscription_status: "past_due",
        });
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        updateSubscriptionByStripeCustomer(invoice.customer, {
          subscription_status: "active",
        });
        break;
      }

      default:
        break;
    }
  } catch (error: any) {
    console.error("[Stripe webhook error]", error);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
