import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--surface)]">
      <div className="bg-[var(--surface-container-lowest)] rounded-3xl p-12 max-w-md text-center shadow-lg">
        <span className="material-symbols-outlined text-6xl text-[var(--outline)] mb-4 block">
          explore_off
        </span>
        <h2 className="text-xl font-bold text-[var(--on-surface)] mb-2">
          Page Not Found
        </h2>
        <p className="text-sm text-[var(--outline)] mb-6">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          href="/overview"
          className="inline-block px-6 py-3 bg-[var(--primary)] text-white rounded-full font-bold text-sm hover:opacity-90 transition-opacity"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
