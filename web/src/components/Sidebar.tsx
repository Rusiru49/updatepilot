"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppWindow, Download, History, LayoutDashboard, Settings, ShieldCheck } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/applications", label: "Applications", icon: AppWindow },
  { href: "/updates", label: "Updates", icon: Download },
  { href: "/security", label: "Security insights", icon: ShieldCheck },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings & agent", icon: Settings },
];

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface p-4 md:flex">
      <Link href="/" className="mb-8 flex items-center gap-2 px-2 text-lg font-extrabold text-primary">
        <span className="h-7 w-7 rounded-md bg-primary" aria-hidden />
        UpdatePilot
      </Link>

      <nav aria-label="Main" className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                active
                  ? "bg-primary-soft font-semibold text-primary"
                  : "text-muted hover:bg-background hover:text-foreground"
              }`}
            >
              <Icon size={18} aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}