"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const navItems = [
  { label: "Dashboard", icon: "space_dashboard", href: "/overview" },
  { label: "Phone Farm", icon: "developer_board", href: "/farm" },
  { label: "CMO Intel", icon: "analytics", href: "/cmo" },
  { label: "Accounts", icon: "manage_accounts", href: "/accounts" },
  { label: "Calendar", icon: "calendar_month", href: "/calendar" },
  { label: "Agents", icon: "smart_toy", href: "/agents" },
  { label: "Radar", icon: "radar", href: "/radar" },
  { label: "Pipeline", icon: "queue", href: "/queue" },
  { label: "Settings", icon: "settings", href: "/settings" },
];

export default function OperationsSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 h-full flex flex-col z-40 w-64 bg-[var(--surface-container-low)]">
      <div className="p-6">
        <Link href="/landing" className="flex items-center gap-3 mb-10 group">
          <div className="w-10 h-10 bg-[var(--primary)] rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
            <span className="material-symbols-outlined text-white text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
              all_inclusive
            </span>
          </div>
          <div>
            <h2 className="text-[var(--on-surface)] font-bold text-lg tracking-tighter">Editorial OS</h2>
            <p className="text-[var(--secondary)] text-[10px] tracking-widest uppercase mt-0.5">Farm v4.2 Active</p>
          </div>
        </Link>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-full text-sm font-medium transition-all duration-300 ${
                  isActive
                    ? "bg-[var(--primary)] text-white shadow-lg shadow-blue-500/20"
                    : "text-[var(--secondary)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]"
                }`}
              >
                <span className="material-symbols-outlined text-lg">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto p-6 pt-4 border-t border-[var(--outline-variant)]/20">
        <button className="w-full bg-[var(--primary)] text-[var(--on-primary)] py-3 rounded-xl font-semibold mb-4 shadow-md transition-all hover:scale-[1.02] active:scale-95 text-sm">
          Deploy Script
        </button>
        <div className="space-y-1">
          <Link
            href="/settings/billing"
            className="flex items-center gap-3 px-4 py-2 text-[var(--secondary)] hover:text-[var(--primary)] rounded-full text-sm font-medium transition-colors"
          >
            <span className="material-symbols-outlined text-lg">credit_card</span>
            Billing
          </Link>
          <a className="flex items-center gap-3 px-4 py-2 text-[var(--secondary)] hover:text-[var(--primary)] rounded-full text-sm font-medium transition-colors cursor-pointer" href="#">
            <span className="material-symbols-outlined text-lg">help</span>
            Support
          </a>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex items-center gap-3 px-4 py-2 text-[var(--secondary)] hover:text-[var(--primary)] rounded-full text-sm font-medium transition-colors w-full text-left"
          >
            <span className="material-symbols-outlined text-lg">logout</span>
            Sign Out
          </button>
        </div>
      </div>
    </aside>
  );
}
