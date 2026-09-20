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
      <body className="antialiased bg-[var(--bg-window)] text-[var(--text-primary)]">
        {children}
      </body>
    </html>
  );
}
