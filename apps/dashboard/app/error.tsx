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
    <div className="min-h-screen flex items-center justify-center bg-[#0F1F17] text-[#F8F6F1] px-4">
      <div className="bg-[#14231B] border border-[#2E4538] rounded-[24px] p-10 max-w-md text-center">
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
        <h2 className="text-lg font-bold mb-2">Something went wrong</h2>
        <p className="text-[13.5px] text-[#A8B5AD] mb-6">
          An unexpected error occurred. You can try again.
        </p>
        {error.digest && (
          <p className="text-[11.5px] text-[#6E7F74] mb-4 font-mono">
            Error ID: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          className="px-6 py-2.5 bg-[#C58E5B] text-[#0F1F17] rounded-full font-bold text-[13.5px] hover:bg-[#D9A76F] transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
