import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OCTRAGON | Autonomous Content Operations",
  description: "Autonomous Phone Farm Operations / CMO Intelligence",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-[var(--bg-primary)] text-[var(--on-surface)] font-['Inter',sans-serif] selection:bg-[var(--primary-fixed)] selection:text-[var(--on-primary-fixed)] min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
