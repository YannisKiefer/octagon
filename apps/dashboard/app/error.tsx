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
    console.error("[Octragon] Unhandled error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--surface)]">
      <div className="bg-[var(--surface-container-lowest)] rounded-3xl p-12 max-w-md text-center shadow-lg">
        <span className="material-symbols-outlined text-6xl text-[var(--error)] mb-4 block">
          error
        </span>
        <h2 className="text-xl font-bold text-[var(--on-surface)] mb-2">
          Something went wrong
        </h2>
        <p className="text-sm text-[var(--outline)] mb-6">
          An unexpected error occurred. Please try again.
        </p>
        {error.digest && (
          <p className="text-xs text-[var(--outline)] mb-4 font-mono">
            Error ID: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          className="px-6 py-3 bg-[var(--primary)] text-white rounded-full font-bold text-sm hover:opacity-90 transition-opacity"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
