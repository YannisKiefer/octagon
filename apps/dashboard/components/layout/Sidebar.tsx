"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/overview", label: "Dashboard", icon: "space_dashboard" },
  { href: "/farm", label: "Phone Farm", icon: "developer_board" },
  { href: "/cmo", label: "CMO Intel", icon: "analytics" },
  { href: "/accounts", label: "Accounts", icon: "manage_accounts" },
  { href: "/calendar", label: "Calendar", icon: "calendar_month" },
  { href: "/agents", label: "Agents", icon: "smart_toy" },
  { href: "/radar", label: "Radar", icon: "radar" },
  { href: "/queue", label: "Pipeline", icon: "queue" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export default function Sidebar() {
  const path = usePathname();

  return (
    <nav className="fixed left-0 top-0 h-full flex flex-col z-40 w-64 bg-[var(--surface-container-low)]">
      <div className="p-6">
        <Link href="/landing" className="flex items-center gap-3 mb-10 group no-underline">
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

        <div className="space-y-1">
          {NAV.map(item => {
            const active = path === item.href || (item.href !== "/" && path.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-full text-sm font-medium transition-all duration-300 no-underline ${
                  active
                    ? "bg-[var(--primary)] text-white shadow-lg shadow-blue-500/20"
                    : "text-[var(--secondary)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]"
                }`}
              >
                <span className="material-symbols-outlined text-lg">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="mt-auto p-6 pt-4">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
          <div>
            <div className="text-xs font-semibold text-[var(--on-surface)]">CMO Heartbeat</div>
            <div className="text-[10px] text-[var(--secondary)] mt-0.5">Learning & Optimizing</div>
          </div>
        </div>
      </div>
    </nav>
  );
}
