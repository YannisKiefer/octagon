import React from "react";

export default function NodeHeader({ status = "Active", title = "NODE: 8-INFINITY" }: { status?: string, title?: string }) {
  return (
    <div className="col-span-12 mb-8">
      <span className="text-xs font-bold text-[var(--primary)] tracking-widest uppercase mb-2 block">
        {status}
      </span>
      <h2 className="text-4xl font-extrabold tracking-tight text-[var(--on-surface)]">
        {title}
      </h2>
    </div>
  );
}
