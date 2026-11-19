"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { Avatar } from "./Avatar";
import { ThemeToggle } from "./ThemeToggle";
import { useLogout } from "./useLogout";
import { NAV_ITEMS, isActive } from "./Sidebar";

export function Topbar() {
  const { user } = useAuth();
  const pathname = usePathname();
  const { askLogout, logoutDialog } = useLogout();
  const navRef = useRef<HTMLElement>(null);

  // Phones: scroll the nav row so the current page's link is visible
  useEffect(() => {
    navRef.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [pathname]);

  const name = user?.displayName ?? "";

  return (
    <header className="border-b border-border bg-surface">
      <div className="flex h-16 items-center justify-between gap-4 px-4 lg:px-8">
        <span className="font-extrabold text-primary md:hidden">UpdatePilot</span>
        <div className="hidden md:block" />
        <div className="flex items-center gap-2">
          <ThemeToggle />

          {/* Avatar + name → profile page */}
          <Link
            href="/profile"
            aria-current={pathname === "/profile" ? "page" : undefined}
            className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1 hover:bg-background sm:pr-3"
            title="Your profile"
          >
            <Avatar name={name} size="sm" />
            <span className="hidden text-sm font-medium sm:inline">{name}</span>
            <span className="sr-only sm:hidden">Your profile</span>
          </Link>

          <button
            type="button"
            onClick={askLogout}
            className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-muted hover:bg-background hover:text-foreground"
          >
            <LogOut size={16} aria-hidden /> <span className="hidden sm:inline">Log out</span>
            <span className="sr-only sm:hidden">Log out</span>
          </button>
        </div>
      </div>

      {/* Small screens: navigation as a scrollable row (the sidebar is hidden there) */}
      <nav ref={navRef} aria-label="Main" className="flex gap-1 overflow-x-auto px-4 pb-3 md:hidden">
        {NAV_ITEMS.map(({ href, label }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap rounded-md px-3 py-2 text-sm ${
                active ? "bg-primary-soft font-semibold text-primary" : "text-muted"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      {logoutDialog}
    </header>
  );
}