import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Octagon",
  description:
    "Local-first console for your iPhone fleet: chat, schedule and monitor Voice Control automation. Everything stays on your Mac.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased bg-[#0F1F17] text-[#F8F6F1]">{children}</body>
    </html>
  );
}
