import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0F1F17] text-[#F8F6F1] px-4">
      <div className="bg-[#14231B] border border-[#2E4538] rounded-[24px] p-10 max-w-md text-center">
        <img src="/logo-reversed.png" alt="Octagon" width="56" height="56" style={{ borderRadius: 8 }} />
        <h2 className="text-lg font-bold mb-2">Page not found</h2>
        <p className="text-[13.5px] text-[#A8B5AD] mb-6">
          This page does not exist.
        </p>
        <Link
          href="/"
          className="inline-block px-6 py-2.5 bg-[#C58E5B] text-[#0F1F17] rounded-full font-bold text-[13.5px] hover:bg-[#D9A76F] transition-colors"
        >
          Back to Octagon
        </Link>
      </div>
    </div>
  );
}
