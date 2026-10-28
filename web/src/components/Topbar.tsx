"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { ThemeToggle } from "./ThemeToggle";
import { NAV_ITEMS, isActive } from "./Sidebar";

export function Topbar() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <header className="border-b border-border bg-surface">
      <div className="flex h-16 items-center justify-between gap-4 px-4 lg:px-8">
        <span className="font-extrabold text-primary md:hidden">UpdatePilot</span>
        <div className="hidden md:block" />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <span className="hidden text-sm text-muted sm:inline">{user?.displayName}</span>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-muted hover:bg-background hover:text-foreground"
          >
            <LogOut size={16} aria-hidden /> Log out
          </button>
        </div>
      </div>

      {/* Small screens: navigation as a scrollable row */}
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-4 pb-3 md:hidden">
        {NAV_ITEMS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${
              isActive(pathname, href) ? "bg-primary-soft font-semibold text-primary" : "text-muted"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}