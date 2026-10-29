"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Laptop, LogOut, Moon, Sun } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Device } from "@/lib/types";
import { formatDate, timeAgo } from "@/lib/format";
import { useAuth } from "@/components/AuthProvider";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, type Tone } from "@/components/ui";

const DEVICE_STATUS: Record<Device["status"], { tone: Tone; label: string }> = {
  ONLINE: { tone: "success", label: "Online" },
  OFFLINE: { tone: "danger", label: "Offline" },
  REVOKED: { tone: "neutral", label: "Revoked" },
};

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setDevices(null);
    try {
      const res = await api<{ items: Device[] }>("/devices");
      setDevices(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Settings &amp; agent</h1>
        <p className="text-sm text-muted">Your computers, appearance and account.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Devices */}
        <div className="space-y-6 lg:col-span-2">
          <section aria-labelledby="devices-heading" className="space-y-3">
            <h2 id="devices-heading" className="font-semibold">Connected devices</h2>

            {error ? (
              <ErrorState message={error} onRetry={load} />
            ) : devices === null ? (
              <Skeleton className="h-40" />
            ) : devices.length === 0 ? (
              <EmptyState
                title="No devices yet"
                message="Install the UpdatePilot agent on your Windows computer and pair it to start scanning."
              />
            ) : (
              devices.map((d) => {
                const s = DEVICE_STATUS[d.status];
                return (
                  <Card key={d.id}>
                    <div className="mb-4 flex flex-wrap items-center gap-3">
                      <Laptop size={20} className="text-muted" aria-hidden />
                      <h3 className="flex-1 font-semibold">{d.deviceName}</h3>
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
                      <dt className="text-muted">Windows</dt>
                      <dd>{d.osVersion ?? "—"}</dd>
                      <dt className="text-muted">Agent version</dt>
                      <dd className="font-mono text-xs leading-5">{d.agentVersion ?? "—"}</dd>
                      <dt className="text-muted">Last seen</dt>
                      <dd>{timeAgo(d.lastSeenAt)}</dd>
                      <dt className="text-muted">Paired</dt>
                      <dd>{formatDate(d.pairedAt)}</dd>
                      <dt className="text-muted">Applications</dt>
                      <dd>{d.applicationCount}</dd>
                      <dt className="text-muted">Added</dt>
                      <dd>{formatDate(d.createdAt)}</dd>
                    </dl>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button variant="secondary" disabled title="Key rotation is built in Week 3">
                        Rotate key
                      </Button>
                      <Button variant="secondary" disabled title="Device revocation is built in Week 3" className="text-danger">
                        Revoke device
                      </Button>
                    </div>
                  </Card>
                );
              })
            )}
          </section>

          <Card>
            <h2 className="mb-2 font-semibold">Pair a new device</h2>
            <p className="mb-4 text-sm text-muted">
              Install the UpdatePilot agent on a Windows 10/11 computer, then enter the pairing code shown here.
            </p>
            <Button disabled title="Agent pairing is built in Week 3">
              Generate pairing code
            </Button>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-semibold">Appearance</h2>
            <ThemeChoice />
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Account</h2>
            <dl className="mb-4 space-y-2 text-sm">
              <div>
                <dt className="text-muted">Name</dt>
                <dd className="font-medium">{user?.displayName}</dd>
              </div>
              <div>
                <dt className="text-muted">Email</dt>
                <dd className="font-medium break-all">{user?.email}</dd>
              </div>
            </dl>
            <Button variant="secondary" onClick={handleLogout}>
              <LogOut size={16} aria-hidden /> Log out
            </Button>
          </Card>

          <Card>
            <h2 className="mb-2 font-semibold">Privacy</h2>
            <p className="text-sm text-muted">
              UpdatePilot stores only software names, versions and job results. It does not collect personal files,
              passwords or browsing history.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ThemeChoice() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  function choose(next: "light" | "dark") {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("up-theme", next);
    } catch {
      /* storage blocked — still applies for this visit */
    }
    setTheme(next);
  }

  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="flex gap-2">
        {(["light", "dark"] as const).map((t) => (
          <label
            key={t}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary ${
              theme === t ? "border-primary bg-primary-soft font-semibold text-primary" : "border-border"
            }`}
          >
            <input
              type="radio"
              name="theme"
              value={t}
              checked={theme === t}
              onChange={() => choose(t)}
              className="sr-only"
            />
            {t === "light" ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
            {t === "light" ? "Light" : "Dark"}
          </label>
        ))}
      </div>
    </fieldset>
  );
}