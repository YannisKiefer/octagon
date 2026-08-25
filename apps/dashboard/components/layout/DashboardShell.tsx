"use client";

import { usePathname } from "next/navigation";
import OperationsSidebar from "./OperationsSidebar";
import TopNavBar from "./TopNavBar";

const AUTH_PATHS = ["/login"];

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen bg-[var(--surface)]">
      <OperationsSidebar />
      <main className="ml-64 flex-1 min-h-screen flex flex-col relative">
        <TopNavBar />
        <div className="flex-1 overflow-y-auto p-8">{children}</div>
      </main>
    </div>
  );
}
