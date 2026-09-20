import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0d0d0f] text-[#f5f5f7] px-4">
      <div className="bg-[#111113] border border-[#2c2c2e] rounded-[24px] p-10 max-w-md text-center">
        <svg
          width="40"
          height="40"
          viewBox="0 0 32 32"
          aria-hidden="true"
          className="mx-auto mb-4"
        >
          <polygon
            points="25.2,19.8 19.8,25.2 12.2,25.2 6.8,19.8 6.8,12.2 12.2,6.8 19.8,6.8 25.2,12.2"
            fill="none"
            stroke="#636366"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
        <h2 className="text-lg font-semibold mb-2">Page not found</h2>
        <p className="text-[13.5px] text-[#98989d] mb-6">
          This page does not exist.
        </p>
        <Link
          href="/"
          className="inline-block px-6 py-2.5 bg-[#f5f5f7] text-black rounded-full font-semibold text-[13.5px] hover:bg-white transition-colors"
        >
          Back to Octagon
        </Link>
      </div>
    </div>
  );
}
