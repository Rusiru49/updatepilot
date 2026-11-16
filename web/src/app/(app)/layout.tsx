"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Not logged in → go to the login page
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted" role="status">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Hidden until you press Tab: lets keyboard users jump past the sidebar and top bar */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:shadow-lg focus:ring-2 focus:ring-primary"
      >
        Skip to main content
      </a>

      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        {/* id="main" is where the skip link jumps to; tabIndex={-1} lets it receive focus */}
        <main id="main" tabIndex={-1} className="flex-1 p-4 focus:outline-none lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}