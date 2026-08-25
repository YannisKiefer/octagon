import React from "react";

export default function TopNavBar() {
  return (
    <header className="sticky top-0 flex justify-between items-center w-full px-8 py-4 z-30 glass-panel border-b border-[var(--outline-variant)]/10">
      <div className="flex items-center gap-8">
        <span className="text-sm font-bold tracking-tight text-[var(--on-surface)]">System Monitor</span>
        <nav className="hidden md:flex gap-6">
          <a className="text-sm font-medium tracking-wide uppercase text-[var(--primary)] border-b-2 border-[var(--primary)] pb-1" href="#">Live View</a>
          <a className="text-sm font-medium tracking-wide uppercase text-[var(--secondary)] hover:text-[var(--on-surface)] transition-opacity" href="#">Logs</a>
          <a className="text-sm font-medium tracking-wide uppercase text-[var(--secondary)] hover:text-[var(--on-surface)] transition-opacity" href="#">Tasks</a>
        </nav>
      </div>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--surface-container-low)] rounded-full">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
          <span className="text-xs font-semibold text-[var(--secondary)]">System Status</span>
        </div>
        <div className="flex items-center gap-3 text-[var(--secondary)]">
          <span className="material-symbols-outlined cursor-pointer hover:text-[var(--primary)] transition-colors">notifications</span>
          <span className="material-symbols-outlined cursor-pointer hover:text-[var(--primary)] transition-colors">cloud_done</span>
        </div>
        <div className="w-8 h-8 rounded-full bg-[var(--surface-container-highest)] overflow-hidden border border-[var(--outline-variant)]/20">
          <div className="w-full h-full bg-[var(--surface-container-high)]" />
        </div>
      </div>
    </header>
  );
}
