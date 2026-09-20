"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Details go to the console only; the UI never shows stack traces.
    console.error("[Octagon] Unhandled error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0d0d0f] text-[#f5f5f7] px-4">
      <div className="bg-[#111113] border border-[#2c2c2e] rounded-[24px] p-10 max-w-md text-center">
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ff453a"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
          className="mx-auto mb-4"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4.5" />
          <path d="M12 15.8v.2" />
        </svg>
        <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
        <p className="text-[13.5px] text-[#98989d] mb-6">
          An unexpected error occurred. You can try again.
        </p>
        {error.digest && (
          <p className="text-[11.5px] text-[#636366] mb-4 font-mono">
            Error ID: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          className="px-6 py-2.5 bg-[#f5f5f7] text-black rounded-full font-semibold text-[13.5px] hover:bg-white transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
