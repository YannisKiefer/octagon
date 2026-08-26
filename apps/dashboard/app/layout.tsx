import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Octagon",
  description: "Your iPhone farm, on autopilot.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="antialiased bg-[#0d0d0f]">
        {children}
      </body>
    </html>
  );
}
