"use client";

import React, { useEffect, useState } from "react";

/* First-run overlay. Shown once, until any choice stores the
   "octagon-onboarded" flag (handled by the parent via onFinish). The demo
   action is honest: a 409 from /api/farm/demo means the farm already has
   data, and that error is shown as-is. */

const SETUP_GUIDE_URL =
  "https://github.com/Yanniskiefer/octagon/blob/main/infra/farm/SETUP-GUIDE.md";

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent tnum"
        aria-hidden="true"
      >
        {n}
      </span>
      <div className="min-w-0 text-[13px] leading-relaxed text-ink-dim">{children}</div>
    </div>
  );
}

export function OnboardingModal({
  onFinish,
}: {
  onFinish: (result: "demo" | "dismiss") => void;
}) {
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [demoError, setDemoError] = useState("");

  // Escape dismisses, like the other modals. The dialog div is not focusable,
  // so an onKeyDown on it would never fire.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !loadingDemo) onFinish("dismiss");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loadingDemo, onFinish]);

  async function loadDemo() {
    setDemoError("");
    setLoadingDemo(true);
    try {
      const res = await fetch("/api/farm/demo", { method: "POST" });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.success) {
        onFinish("demo");
        return;
      }
      setDemoError(String(j?.error || `Could not load demo data (HTTP ${res.status}).`));
    } catch {
      setDemoError("Could not load demo data. The farm API is unreachable.");
    }
    setLoadingDemo(false);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to Octagon"
        className="w-full bg-surface border border-hairline rounded-2xl shadow-2xl overflow-hidden"
        style={{ maxWidth: 460 }}
      >
        <div className="px-6 pt-6 pb-5">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/glyph-white.png" alt="" width={26} height={26} draggable={false} />
            <h1 className="text-[17px] font-semibold text-ink">Welcome to Octagon</h1>
          </div>

          <div className="mt-5 space-y-4">
            <Step n={1}>
              <p>
                This console runs sessions on iPhones you own - everything stays on this Mac.
              </p>
            </Step>
            <Step n={2}>
              <p>
                {`On each iPhone: Settings > Accessibility > Voice Control > On, then create the custom command '<Prefix> Swipe Next' (swipe up). `}
                <a
                  href={SETUP_GUIDE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent underline underline-offset-2 hover:text-accent-hover"
                >
                  Full guide in the setup guide
                </a>
                .
              </p>
            </Step>
            <Step n={3}>
              <p>See it work with sample data, or start from an empty farm.</p>
              <div className="mt-3 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={loadDemo}
                  disabled={loadingDemo}
                  className="w-full rounded-control bg-accent px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loadingDemo ? "Loading demo data" : "Load demo data"}
                </button>
                <button
                  type="button"
                  onClick={() => onFinish("dismiss")}
                  disabled={loadingDemo}
                  className="w-full rounded-control border border-hairline bg-raised px-4 py-2.5 text-[13px] font-medium text-ink-dim transition-colors hover:bg-hover disabled:opacity-50"
                >
                  Explore with an empty farm
                </button>
              </div>
              {demoError && (
                <p className="mt-2.5 text-[12px] text-danger leading-relaxed" role="alert">
                  {demoError}
                </p>
              )}
            </Step>
          </div>
        </div>

        <div className="border-t border-hairline px-6 py-3">
          <button
            type="button"
            onClick={() => onFinish("dismiss")}
            disabled={loadingDemo}
            className="text-[12px] text-ink-mute underline underline-offset-2 transition-colors hover:text-ink-dim disabled:opacity-50"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
