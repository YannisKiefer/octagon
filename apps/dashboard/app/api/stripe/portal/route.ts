import { NextResponse } from "next/server";
import { getUserSubscription, getDefaultUserId } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
    }

    const userId = getDefaultUserId();
    const sub = getUserSubscription(userId);

    if (!sub?.stripe_customer_id) {
      return NextResponse.json({ error: "No active subscription found." }, { status: 400 });
    }

    const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_URL || "http://localhost:5000";

    const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        customer: sub.stripe_customer_id,
        return_url: `${origin}/settings/billing`,
      }).toString(),
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
