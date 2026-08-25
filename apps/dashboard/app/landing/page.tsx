"use client";

import { useState } from "react";
import Link from "next/link";
import { TIER_CONFIGS } from "@/lib/tiers";

const FEATURES = [
  {
    icon: "▣",
    title: "Warm + Keep Healthy",
    desc: "Every fresh account scrolls, likes, and follows like a real user for days before its first post — then stays warm for months. No cold posts.",
  },
  {
    icon: "⬡",
    title: "Phone Farm Ops",
    desc: "One Mac drives 10+ real iPhones over Voice Control. Global TTS mutex, 3-5s stagger, heartbeat — so nothing double-posts.",
  },
  {
    icon: "◈",
    title: "Human Taps Only",
    desc: "No APIs. No emulators. Real taps on real iPhones — that's why accounts survive for months, not days.",
  },
  {
    icon: "◉",
    title: "Post From Anywhere",
    desc: "Drop a clip from phone or laptop. Your Mac grabs it on the next slot and auto-posts to TikTok + Instagram.",
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
    <div className="font-['Inter',sans-serif] bg-[#0A0A0A] text-white">
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-5 border-b border-white/5 bg-[#0A0A0A]/90 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 bg-white flex items-center justify-center">
            <span className="text-black text-xs font-black">◈</span>
          </div>
          <span className="text-white font-black uppercase tracking-tighter text-sm">PHONE FARM OS</span>
          <span className="text-white/20 text-[10px] font-bold uppercase tracking-widest ml-2">Octragon</span>
        </div>
        <div className="flex items-center gap-6">
          <a href="#lifecycle" className="text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest transition-colors hidden md:block">Lifecycle</a>
          <a href="#technology" className="text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest transition-colors hidden md:block">Technology</a>
          <a href="#pricing" className="text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest transition-colors">Pricing</a>
          <Link href="/overview" className="text-white text-xs font-black uppercase tracking-widest border border-white/20 px-4 py-2 hover:bg-white hover:text-black transition-all">
            Dashboard →
          </Link>
        </div>
      </nav>

      {/* HERO — Warmr narrative */}
      <section className="min-h-[92vh] flex flex-col items-center justify-center px-8 pt-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:80px_80px] pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-white/[0.015] rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 border border-white/10 px-4 py-2 mb-10 text-[10px] font-black uppercase tracking-[0.3em] text-white/30">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full inline-block animate-pulse" />
            Your iPhone farm, on autopilot
          </div>

          <h1 className="text-[48px] md:text-[72px] font-black uppercase leading-[0.9] tracking-tighter text-white mb-6">
            YOUR IPHONE FARM,<br />
            <span className="text-white/20">ON AUTOPILOT.</span>
          </h1>

          <p className="text-white/60 text-[17px] font-medium max-w-2xl mx-auto mb-4 leading-relaxed">
            Plug in iPhones and Phone Farm OS takes any account — even brand-new ones — from cold to consistently posting. It warms them up, keeps them healthy, and auto-posts to TikTok and Instagram on schedule.
          </p>
          <p className="text-white/30 text-sm max-w-xl mx-auto mb-10">
            Open the dashboard. Press Deploy. Get back to building. The notification arrives: <span className="text-white font-bold">18 of 18 posted.</span> You didn&apos;t touch it.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="#lifecycle"
              className="bg-white text-black px-10 py-4 text-[11px] font-black uppercase tracking-[0.3em] hover:bg-white/90 transition-all w-full sm:w-auto text-center"
            >
              See how it works
            </a>
            <Link
              href="/overview"
              className="border border-white/20 text-white px-10 py-4 text-[11px] font-black uppercase tracking-[0.3em] hover:border-white/40 transition-all w-full sm:w-auto text-center"
            >
              View Live Farm
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-16 max-w-3xl mx-auto">
            {[
              { val: "2", label: "posting platforms", sub: "TikTok + Instagram" },
              { val: "24/7", label: "runs while you sleep", sub: "resumes after errors" },
              { val: "10+", label: "real iPhones per Mac", sub: "zero hires" },
              { val: "<1min", label: "per published post", sub: "fully scripted cycle" },
            ].map((stat) => (
              <div key={stat.label} className="text-center border border-white/5 bg-white/[0.02] py-6 px-4">
                <div className="text-2xl font-black text-white mb-1">{stat.val}</div>
                <div className="text-[10px] font-black uppercase tracking-widest text-white/60">{stat.label}</div>
                <div className="text-[10px] text-white/25 mt-1">{stat.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PAIN vs SOLUTION */}
      <section className="py-20 px-8 max-w-6xl mx-auto">
        <div className="grid md:grid-cols-2 gap-12 items-start">
          <div className="border border-white/10 p-8 bg-[#111]">
            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-red-400 mb-4">Before</div>
            <h3 className="text-xl font-black uppercase text-white mb-4 leading-tight">Three accounts take an hour. Twenty take a workday.</h3>
            <p className="text-white/50 text-sm leading-relaxed mb-6">Manual login, switch accounts, paste a caption, pick music, hit post. Repeat. A device hangs mid-upload and you don&apos;t know what published.</p>
            <ul className="space-y-2 text-sm text-white/40">
              <li className="flex gap-2"><span className="text-red-400">✗</span> Hours lost to posting every morning</li>
              <li className="flex gap-2"><span className="text-red-400">✗</span> API bots get accounts banned in a week</li>
              <li className="flex gap-2"><span className="text-red-400">✗</span> Rented farms hold your accounts on their hardware</li>
            </ul>
          </div>
          <div className="border border-emerald-500/20 p-8 bg-emerald-500/[0.04]">
            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-400 mb-4">After</div>
            <h3 className="text-xl font-black uppercase text-white mb-4 leading-tight">Open the app. Press start. Get back to building.</h3>
            <p className="text-white/50 text-sm leading-relaxed mb-6">Marketing runs while you build. Your accounts, your devices, your data. Real iPhones keep accounts healthy for months.</p>
            <ul className="space-y-2 text-sm text-white/60">
              <li className="flex gap-2"><span className="text-emerald-400">✓</span> Marketing runs while you build</li>
              <li className="flex gap-2"><span className="text-emerald-400">✓</span> Your accounts, your devices, your data</li>
              <li className="flex gap-2"><span className="text-emerald-400">✓</span> Real iPhones keep accounts healthy for months</li>
              <li className="flex gap-2"><span className="text-emerald-400">✓</span> Post from anywhere with Cloud Drop</li>
            </ul>
          </div>
        </div>
      </section>

      {/* LIFECYCLE */}
      <section id="lifecycle" className="py-24 px-8 max-w-6xl mx-auto border-t border-white/5">
        <div className="mb-12">
          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 mb-3">The whole lifecycle</div>
          <h2 className="text-4xl md:text-5xl font-black uppercase leading-tight text-white">From a fresh account<br /><span className="text-white/20">to posting.</span></h2>
          <p className="text-white/30 text-sm mt-4 max-w-xl">Phone Farm OS owns every stage, so a brand-new login becomes a healthy, posting account without you babysitting it.</p>
        </div>
        <div className="grid md:grid-cols-5 gap-px border border-white/10 bg-white/10">
          {[
            { n: "1", t: "Fresh account", d: "Brand-new login, no posting yet", c: "watchlist + niche assignment" },
            { n: "2", t: "Warmed up", d: "Scrolls, likes, follows daily", c: "Voice warmup 30-60m" },
            { n: "3", t: "Matured", d: "Ready to post, not flagged", c: "Parity scorer green" },
            { n: "4", t: "Kept warm", d: "Stays healthy for months", c: "Light warmups, battery guard" },
            { n: "5", t: "Posting", d: "Every post warm-up wrapped", c: "Variation → Cloud Drop → post" },
          ].map((s) => (
            <div key={s.n} className="bg-[#0A0A0A] p-6">
              <div className="text-3xl font-black text-white/10 mb-3">{s.n}</div>
              <div className="text-sm font-black uppercase text-white mb-2">{s.t}</div>
              <div className="text-xs text-white/30 mb-3 leading-relaxed">{s.d}</div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/60">{s.c}</div>
            </div>
          ))}
        </div>
      </section>

      {/* TECHNOLOGY */}
      <section id="technology" className="py-24 px-8 max-w-6xl mx-auto">
        <div className="mb-12 text-center">
          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 mb-3">Technology</div>
          <h2 className="text-4xl font-black uppercase text-white">Why it works.</h2>
          <p className="text-white/30 text-sm mt-3">Four reasons accounts stay alive for months, not days.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-px border border-white/10 bg-white/10">
          {[
            { t: "It acts like a real person.", d: "No APIs. No bots. No emulators. Phone Farm OS drives real iPhones and taps exactly like a human, so platforms can't tell it from you.", tag: "No APIs · No bots · Just real taps" },
            { t: "One Mac runs the whole farm.", d: "One Mac drives ten-plus iPhones at once, with locks so nothing double-posts. Go from one account to fifty without hiring a soul.", tag: "Up to 8 accounts per platform, per iPhone" },
            { t: "Every account warms up first.", d: "Before it ever posts, each account scrolls, likes, and follows like a real user, so your content lands with reach instead of dying cold.", tag: "Scroll · Like · Follow · Post · Rest" },
            { t: "Post from anywhere.", d: "Drop a clip from your phone or laptop. Your Mac grabs it and posts to every account you picked, on the next open slot.", tag: "Drop it · Mac pulls · It posts" },
          ].map((f) => (
            <div key={f.t} className="bg-[#111] p-8">
              <h3 className="text-white font-black uppercase text-sm mb-3">{f.t}</h3>
              <p className="text-white/40 text-sm leading-relaxed mb-4">{f.d}</p>
              <div className="text-[10px] font-black uppercase tracking-widest text-white/20">{f.tag}</div>
            </div>
          ))}
        </div>
      </section>

      {/* COMPARISON */}
      <section className="py-24 px-8 max-w-6xl mx-auto border-t border-white/5">
        <div className="mb-10 text-center">
          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 mb-3">Comparison</div>
          <h2 className="text-4xl font-black uppercase text-white">Why not manual, bots, or rented farms.</h2>
          <p className="text-white/30 text-sm mt-3">Most operators pay $2,000/mo to rent hardware they don&apos;t own. Phone Farm OS is yours.</p>
        </div>
        <div className="overflow-x-auto border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#111] text-white/30 text-[10px] font-black uppercase tracking-widest">
                <th className="text-left p-4 font-black"></th><th className="text-left p-4">Manual</th><th className="text-left p-4">API bots</th><th className="text-left p-4">Rented farms</th><th className="text-left p-4 text-emerald-400">Phone Farm OS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {[
                ["Devices", "your phone", "emulated", "cloud phones", "real iPhones you own"],
                ["Shadowban risk", "Low", "High (300 view jail)", "High (cloud phones)", "Low (real iPhones)"],
                ["Monthly cost", "your time", "cheap", "$2,000+/mo", "from $0/mo (self-hosted)"],
                ["Account warm-up", "by hand", "none", "you can't see it", "built-in, fresh → matured"],
                ["Time for 20 accounts", "~4 hrs", "~30 min", "wait on them", "~20 min"],
                ["Scaling", "your hours", "API limits", "billed per minute", "plug in more iPhones"],
                ["Crash recovery", "start over", "none", "support ticket", "auto-resume"],
              ].map((row) => (
                <tr key={row[0]} className="bg-[#0A0A0A]">
                  <td className="p-4 font-black text-white/60 whitespace-nowrap">{row[0]}</td>
                  <td className="p-4 text-white/40">{row[1]}</td>
                  <td className="p-4 text-white/40">{row[2]}</td>
                  <td className="p-4 text-white/40">{row[3]}</td>
                  <td className="p-4 font-bold text-emerald-300">{row[4]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-center text-white/20 text-xs mt-6">Why not unofficial APIs? Reverse-engineered bot APIs are the fastest way to lose an account. Phone Farm OS never touches them — it drives real iOS devices with Voice Control.</p>
      </section>

      <section id="features" className="py-20 px-8 max-w-6xl mx-auto">
        <div className="mb-12 text-center">
          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 mb-4">System Components</div>
          <h2 className="text-4xl font-black uppercase leading-tight text-white">Four Modules.<br />One Machine.</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px border border-white/5">
          {FEATURES.map((f, i) => (
            <div key={f.title} className={`p-8 border-white/5 ${i < 2 ? "border-b" : ""} ${i % 2 === 0 ? "border-r" : ""}`}>
              <div className="text-3xl text-white/20 mb-6">{f.icon}</div>
              <h3 className="text-lg font-black uppercase tracking-tight text-white mb-4">{f.title}</h3>
              <p className="text-white/40 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-12 px-8 bg-[#070707] border-y border-white/5">
        <div className="max-w-6xl mx-auto overflow-hidden">
          <div className="flex gap-12 items-center text-white/10 text-[11px] font-black uppercase tracking-[0.3em] whitespace-nowrap">
            {["Phone Farm OS", "Octragon", "Voice Control", "Viral DNA", "CMO Intel", "Real Taps", "WARM → MATURED → POSTING"].map((item) => (
              <span key={item}>{item} —</span>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="py-24 px-8 max-w-6xl mx-auto">
        <div className="mb-12 text-center">
          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 mb-4">Pricing</div>
          <h2 className="text-4xl font-black uppercase leading-tight text-white">Pick your farm.</h2>
          <p className="text-white/30 mt-4 text-sm max-w-lg mx-auto">Self-hosted is free and MIT. These tiers are for the hosted comparison — what Warmr charges.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px border border-white/10">
          <PricingCard tier={TIER_CONFIGS.solo} />
          <PricingCard tier={TIER_CONFIGS.studio} highlighted />
          <PricingCard tier={TIER_CONFIGS.enterprise} />
        </div>
        <p className="text-center text-white/20 text-xs mt-6">With Phone Farm OS (self-hosted): <span className="text-white/60 font-bold">$0/mo</span> + your Mac + your iPhones — no per-minute billing.</p>
      </section>

      <section className="py-20 px-8 max-w-4xl mx-auto text-center">
        <h2 className="text-5xl font-black uppercase leading-tight text-white mb-6">
          Ready to<br />Automate?
        </h2>
        <p className="text-white/30 text-sm mb-10 max-w-md mx-auto">
          Connect your first phone and run your first autonomous pipeline in under 10 minutes.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/overview" className="inline-block bg-white text-black px-10 py-4 text-[11px] font-black uppercase tracking-[0.3em] hover:bg-white/90 transition-all">
            Open Farm Dashboard
          </Link>
          <a href="https://github.com/YannisKiefer/phone-farm-os" className="inline-block border border-white/20 text-white px-10 py-4 text-[11px] font-black uppercase tracking-[0.3em] hover:border-white/40 transition-all">
            View on GitHub
          </a>
        </div>
      </section>

      <footer className="border-t border-white/5 py-10 px-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 bg-white flex items-center justify-center">
              <span className="text-black text-xs font-black">◈</span>
            </div>
            <span className="text-white/30 font-black uppercase tracking-tighter text-xs">PHONE FARM OS</span>
            <span className="text-white/15 text-[10px] ml-2">/ OCTRAGON</span>
          </div>
          <div className="text-white/20 text-[10px] font-bold uppercase tracking-widest">Autonomous Content Operations · MIT</div>
        </div>
      </footer>
    </div>
  );
}
