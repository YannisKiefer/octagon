"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

const STEPS = [
  {
    id: 1,
    title: "Confirm Your Plan",
    icon: "◈",
    desc: "Review your subscription and usage limits.",
  },
  {
    id: 2,
    title: "Connect Your Device",
    icon: "⬡",
    desc: "Connect your first ADB-enabled phone to the farm.",
  },
  {
    id: 3,
    title: "Seed Your Account",
    icon: "▣",
    desc: "Add your first social media account to the pipeline.",
  },
  {
    id: 4,
    title: "Run Test Scrape",
    icon: "◉",
    desc: "Trigger your first scrape to verify the pipeline works.",
  },
  {
    id: 5,
    title: "Launch",
    icon: "✦",
    desc: "Your autonomous system is ready.",
  },
];

function StepIndicator({ step, currentStep }: { step: typeof STEPS[0]; currentStep: number }) {
  const done = step.id < currentStep;
  const active = step.id === currentStep;
  return (
    <div className="flex items-center gap-4">
      <div
        className={`w-8 h-8 flex items-center justify-center border text-xs font-black transition-all ${
          done
            ? "bg-white border-white text-black"
            : active
            ? "border-white text-white"
            : "border-white/10 text-white/20"
        }`}
      >
        {done ? "✓" : step.id}
      </div>
      <div>
        <div className={`text-xs font-black uppercase tracking-widest ${active ? "text-white" : done ? "text-white/40" : "text-white/20"}`}>
          {step.title}
        </div>
      </div>
    </div>
  );
}

function OnboardingContent() {
  const searchParams = useSearchParams();
  const tier = searchParams.get("tier") || "solo";
  const [currentStep, setCurrentStep] = useState(1);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("octragon_onboarding_step");
    if (saved) {
      setCurrentStep(Number(saved));
    }
  }, []);

  function advanceStep() {
    const next = Math.min(currentStep + 1, STEPS.length);
    setCurrentStep(next);
    localStorage.setItem("octragon_onboarding_step", String(next));
    if (next === STEPS.length) {
      setCompleted(true);
    }
  }

  const step = STEPS[currentStep - 1];

  if (completed && currentStep === STEPS.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-8 text-center">
        <div className="text-5xl mb-6 text-white/20">✦</div>
        <h1 className="text-4xl font-black uppercase tracking-tight text-white mb-4">
          System Online
        </h1>
        <p className="text-white/40 text-sm max-w-sm mb-10">
          Your autonomous content pipeline is active. Go to the dashboard to monitor operations.
        </p>
        <div className="flex gap-4">
          <Link
            href="/overview"
            className="bg-white text-black px-10 py-4 text-[11px] font-black uppercase tracking-widest hover:bg-white/90 transition-all"
            onClick={() => localStorage.removeItem("octragon_onboarding_step")}
          >
            Open Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-72 border-r border-white/5 p-10 flex flex-col gap-6 bg-[#070707]">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-6 h-6 bg-white flex items-center justify-center">
            <span className="text-black text-xs font-black">8</span>
          </div>
          <span className="text-white font-black uppercase tracking-tighter text-sm">OCTRAGON</span>
        </div>
        {STEPS.map((s) => (
          <StepIndicator key={s.id} step={s} currentStep={currentStep} />
        ))}
        <div className="mt-auto">
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/20 mb-2">Plan</div>
          <div className="text-sm font-black uppercase tracking-tight text-white capitalize">{tier === "solo" ? "Solo Clipper" : tier === "studio" ? "Studio" : "Enterprise"}</div>
        </div>
      </aside>

      <main className="flex-1 flex items-center justify-center p-16">
        <div className="max-w-lg w-full">
          <div className="text-white/20 text-4xl mb-6">{step.icon}</div>
          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30 mb-3">
            Step {currentStep} of {STEPS.length}
          </div>
          <h2 className="text-4xl font-black uppercase tracking-tight text-white mb-4">{step.title}</h2>
          <p className="text-white/40 text-sm leading-relaxed mb-12">{step.desc}</p>

          {currentStep === 1 && (
            <div className="border border-white/10 p-6 mb-10 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Plan</span>
                <span className="text-xs font-black text-white capitalize">{tier === "solo" ? "Solo Clipper" : tier === "studio" ? "Studio" : "Enterprise"}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Status</span>
                <span className="text-xs font-black text-white">Active</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Trial</span>
                <span className="text-xs font-black text-white">14 days free</span>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="border border-white/10 p-6 mb-10 font-mono text-xs text-white/40 space-y-2">
              <div className="text-white/20 mb-4 font-bold non-mono text-[10px] uppercase tracking-widest">ADB Setup Instructions</div>
              <div>1. Enable USB debugging on your iPhone via ADB-over-WiFi</div>
              <div>2. Run: <code className="text-white">adb devices</code> to verify connection</div>
              <div>3. Confirm device appears in the Farm dashboard</div>
              <div className="pt-4 text-white/20">You can also skip this step and connect your device later from the Farm page.</div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="border border-white/10 p-6 mb-10 space-y-4">
              <div className="text-white/20 text-[10px] font-bold uppercase tracking-widest mb-4">Account Configuration</div>
              <div className="text-white/40 text-xs">
                Navigate to the <strong className="text-white">Accounts</strong> section to add your first TikTok, Instagram, or LinkedIn account. Your account will be assigned to a phone slot and niche automatically.
              </div>
            </div>
          )}

          {currentStep === 4 && (
            <div className="border border-white/10 p-6 mb-10 space-y-4">
              <div className="text-white/20 text-[10px] font-bold uppercase tracking-widest mb-4">Pipeline Test</div>
              <div className="text-white/40 text-xs">
                Go to the <strong className="text-white">CMO Intel</strong> page to trigger a test scrape from any active watchlist account. The pipeline will scrape, forge, and queue a post for approval.
              </div>
            </div>
          )}

          <button
            onClick={advanceStep}
            className="bg-white text-black px-10 py-4 text-[11px] font-black uppercase tracking-widest hover:bg-white/90 transition-all"
          >
            {currentStep === STEPS.length - 1 ? "Complete Setup" : "Continue →"}
          </button>

          {currentStep > 1 && (
            <button
              onClick={() => {
                const prev = currentStep - 1;
                setCurrentStep(prev);
                localStorage.setItem("octragon_onboarding_step", String(prev));
              }}
              className="ml-4 text-xs font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors"
            >
              ← Back
            </button>
          )}

          {currentStep < STEPS.length && (
            <div className="mt-6">
              <Link href="/overview" className="text-xs font-bold uppercase tracking-widest text-white/20 hover:text-white/40 transition-colors">
                Skip setup →
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-white/20 text-sm">Loading...</div>}>
      <OnboardingContent />
    </Suspense>
  );
}
