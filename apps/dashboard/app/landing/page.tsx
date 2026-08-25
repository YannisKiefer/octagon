"use client";

import { useState } from "react";
import Link from "next/link";
import { TIER_CONFIGS } from "@/lib/tiers";

const FEATURES = [
  {
    icon: "▣",
    title: "Editorial OS",
    desc: "AI-powered content strategy that analyzes viral DNA patterns across your accounts and prescribes exactly what to post, when, and why — with CMO-grade reasoning.",
  },
  {
    icon: "⬡",
    title: "Phone Farm Ops",
    desc: "Control fleets of ADB-connected iOS devices remotely. Automate warmup sessions, session patterns, and multi-account operations with millisecond precision.",
  },
  {
    icon: "◈",
    title: "AI Video Forging",
    desc: "Transform scraped viral content into forensically unique variations using 5-layer processing: fps, crop, audio pitch, re-encode, and noise-seeded metadata injection.",
  },
  {
    icon: "◉",
    title: "Autonomous Posting",
    desc: "Full pipeline automation from scrape to post. Telegram-based approval flow. Hook analysis. Delivery tracking. Zero manual intervention required.",
  },
];

function PricingCard({
  tier,
  highlighted,
}: {
  tier: (typeof TIER_CONFIGS)[keyof typeof TIER_CONFIGS];
  highlighted?: boolean;
}) {
  const [loading, setLoading] = useState(false);

  async function handleSubscribe() {
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: tier.id }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || "Failed to create checkout session");
      }
    } catch {
      alert("Failed to connect to payment system");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className={`relative flex flex-col border ${
        highlighted
          ? "border-white bg-white text-black"
          : "border-white/10 bg-[#111] text-white"
      } p-8 transition-all`}
    >
      {highlighted && (
        <div className="absolute -top-3 left-8 bg-black text-white text-[10px] font-black uppercase tracking-widest px-3 py-1 border border-white/20">
          Most Popular
        </div>
      )}
      <div className={`text-[10px] font-black uppercase tracking-[0.3em] mb-3 ${highlighted ? "text-black/60" : "text-white/40"}`}>
        {tier.name}
      </div>
      <div className="flex items-baseline gap-1 mb-2">
        <span className="text-5xl font-black">${tier.price}</span>
        <span className={`text-sm font-medium ${highlighted ? "text-black/50" : "text-white/40"}`}>/mo</span>
      </div>
      <div className={`text-xs mb-8 ${highlighted ? "text-black/50" : "text-white/40"}`}>
        {tier.phones === null ? "Unlimited scale" : `${tier.phones} phone${tier.phones > 1 ? "s" : ""} · ${tier.accounts} accounts · ${tier.postsPerDay} posts/day`}
      </div>
      <ul className="space-y-3 mb-10 flex-1">
        {tier.features.map((f) => (
          <li key={f} className={`flex items-start gap-3 text-sm ${highlighted ? "text-black/80" : "text-white/60"}`}>
            <span className={`mt-0.5 text-xs ${highlighted ? "text-black" : "text-white"}`}>▸</span>
            {f}
          </li>
        ))}
      </ul>
      <button
        onClick={handleSubscribe}
        disabled={loading}
        className={`w-full py-4 text-[11px] font-black uppercase tracking-widest transition-all ${
          highlighted
            ? "bg-black text-white hover:bg-black/80"
            : "bg-white text-black hover:bg-white/90"
        } disabled:opacity-50`}
      >
        {loading ? "Redirecting..." : "Start Now"}
      </button>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="font-['Inter',sans-serif]">
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-5 border-b border-white/5 bg-[#0A0A0A]/90 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 bg-white flex items-center justify-center">
            <span className="text-black text-xs font-black">8</span>
          </div>
          <span className="text-white font-black uppercase tracking-tighter text-sm">OCTRAGON</span>
        </div>
        <div className="flex items-center gap-6">
          <a href="#features" className="text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest transition-colors">Features</a>
          <a href="#pricing" className="text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest transition-colors">Pricing</a>
          <Link href="/overview" className="text-white text-xs font-black uppercase tracking-widest border border-white/20 px-4 py-2 hover:bg-white hover:text-black transition-all">
            Dashboard →
          </Link>
        </div>
      </nav>

      <section className="min-h-screen flex flex-col items-center justify-center px-8 pt-20 relative overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:80px_80px] pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-white/[0.01] rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 border border-white/10 px-4 py-2 mb-10 text-[10px] font-black uppercase tracking-[0.3em] text-white/30">
            <span className="w-1.5 h-1.5 bg-white rounded-full inline-block animate-pulse" />
            Autonomous Content Operations
          </div>

          <h1 className="text-[72px] md:text-[96px] font-black uppercase leading-[0.9] tracking-tighter text-white mb-8">
            THE CONTENT<br />
            <span className="text-white/20">MACHINE</span>
          </h1>

          <p className="text-white/40 text-lg font-medium max-w-xl mx-auto mb-12 leading-relaxed">
            Octragon transforms your phone farm into a fully autonomous editorial operation — scraping, forging, analyzing, and posting viral content at scale, with zero manual work.
          </p>

          <div className="flex items-center justify-center gap-4">
            <a
              href="#pricing"
              className="bg-white text-black px-10 py-4 text-[11px] font-black uppercase tracking-[0.3em] hover:bg-white/90 transition-all"
            >
              Start Free Trial
            </a>
            <Link
              href="/overview"
              className="border border-white/20 text-white px-10 py-4 text-[11px] font-black uppercase tracking-[0.3em] hover:border-white/40 transition-all"
            >
              View Dashboard
            </Link>
          </div>

          <div className="grid grid-cols-3 gap-8 mt-24 max-w-2xl mx-auto">
            {[
              { val: "∞", label: "Content Sources" },
              { val: "5x", label: "Faster Posting" },
              { val: "100%", label: "Autonomous" },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-4xl font-black text-white mb-2">{stat.val}</div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-white/30">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="py-32 px-8 max-w-6xl mx-auto">
        <div className="mb-20 text-center">
          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 mb-4">System Architecture</div>
          <h2 className="text-5xl font-black uppercase leading-tight text-white">Four Modules.<br />One Machine.</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px border border-white/5">
          {FEATURES.map((f, i) => (
            <div key={f.title} className={`p-10 border-white/5 ${i < 2 ? "border-b" : ""} ${i % 2 === 0 ? "border-r" : ""}`}>
              <div className="text-3xl text-white/20 mb-6">{f.icon}</div>
              <h3 className="text-xl font-black uppercase tracking-tight text-white mb-4">{f.title}</h3>
              <p className="text-white/40 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-24 px-8 bg-[#070707] border-y border-white/5">
        <div className="max-w-6xl mx-auto overflow-hidden">
          <div className="flex gap-16 items-center text-white/10 text-[11px] font-black uppercase tracking-[0.3em] whitespace-nowrap">
            {["Editorial OS", "Phone Farm", "AI Forging", "Viral DNA", "CMO Intel", "Autonomous Posting", "Hook Analysis", "Delivery Tracking"].map((item) => (
              <span key={item}>{item} —</span>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="py-32 px-8 max-w-6xl mx-auto">
        <div className="mb-20 text-center">
          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 mb-4">Pricing</div>
          <h2 className="text-5xl font-black uppercase leading-tight text-white">Scale Without Limits</h2>
          <p className="text-white/30 mt-4 text-sm max-w-lg mx-auto">Start with a single phone. Grow to an enterprise operation. All plans include a 14-day free trial.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px border border-white/10">
          <PricingCard tier={TIER_CONFIGS.solo} />
          <PricingCard tier={TIER_CONFIGS.studio} highlighted />
          <PricingCard tier={TIER_CONFIGS.enterprise} />
        </div>
      </section>

      <section className="py-32 px-8 max-w-4xl mx-auto text-center">
        <h2 className="text-6xl font-black uppercase leading-tight text-white mb-8">
          Ready to<br />Automate?
        </h2>
        <p className="text-white/30 text-sm mb-12 max-w-md mx-auto">
          Connect your first phone and run your first autonomous pipeline in under 10 minutes.
        </p>
        <a
          href="#pricing"
          className="inline-block bg-white text-black px-16 py-5 text-[11px] font-black uppercase tracking-[0.3em] hover:bg-white/90 transition-all"
        >
          Get Started — Free Trial
        </a>
      </section>

      <footer className="border-t border-white/5 py-10 px-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 bg-white flex items-center justify-center">
              <span className="text-black text-xs font-black">8</span>
            </div>
            <span className="text-white/30 font-black uppercase tracking-tighter text-xs">OCTRAGON OS</span>
          </div>
          <div className="text-white/20 text-[10px] font-bold uppercase tracking-widest">Autonomous Content Operations</div>
        </div>
      </footer>
    </div>
  );
}
