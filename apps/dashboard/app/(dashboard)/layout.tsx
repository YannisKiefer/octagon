import OperationsSidebar from "@/components/layout/OperationsSidebar";
import TopNavBar from "@/components/layout/TopNavBar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[var(--surface)]">
      <OperationsSidebar />
      <main className="ml-64 flex-1 min-h-screen flex flex-col relative">
        <TopNavBar />
        <div className="flex-1 overflow-y-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
