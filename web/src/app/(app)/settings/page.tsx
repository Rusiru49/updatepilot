"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Laptop, LogOut, Moon, Sun } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Device } from "@/lib/types";
import { formatDate, timeAgo } from "@/lib/format";
import { usePageTitle } from "@/lib/usePageTitle";
import { useAuth } from "@/components/AuthProvider";
import { Avatar } from "@/components/Avatar";
import { useLogout } from "@/components/useLogout";
import { Badge, Banner, Button, Card, EmptyState, ErrorState, Skeleton, type Tone } from "@/components/ui";
import { setTheme, useTheme, type Theme } from "@/lib/theme";

const DEVICE_STATUS: Record<Device["status"], { tone: Tone; label: string }> = {
  ONLINE: { tone: "success", label: "Online" },
  OFFLINE: { tone: "danger", label: "Offline" },
  REVOKED: { tone: "neutral", label: "Revoked" },
};

export default function SettingsPage() {
  usePageTitle("Settings");
  const { user } = useAuth();
  const { askLogout, logoutDialog } = useLogout();

  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pairing, setPairing] = useState<{ code: string; expiresAt: string; devicesBefore: number } | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairedMessage, setPairedMessage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  // First load (shows the loading skeleton)
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

  // Refresh the list without showing the loading skeleton
  const refreshDevices = useCallback(async () => {
    try {
      const res = await api<{ items: Device[] }>("/devices");
      setDevices(res.items);
      return res.items;
    } catch {
      return null;
    }
  }, []);

  async function generateCode() {
    setGenerating(true);
    setPairingError(null);
    setPairedMessage(null);
    try {
      const res = await api<{ code: string; expiresAt: string }>("/devices/pairing-codes", { method: "POST" });
      setPairing({ ...res, devicesBefore: devices?.length ?? 0 });
    } catch (err) {
      setPairingError(err instanceof ApiError ? err.message : "Couldn't create a pairing code");
    } finally {
      setGenerating(false);
    }
  }

  // While a code is showing, check every 5 s whether a new device has paired
  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(async () => {
      const items = await refreshDevices();
      if (items && items.length > pairing.devicesBefore) {
        const newest = [...items].sort((a, b) => (b.pairedAt ?? "").localeCompare(a.pairedAt ?? ""))[0];
        setPairedMessage(`${newest.deviceName} is now connected.`);
        setPairing(null);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [pairing, refreshDevices]);

  async function revokeDevice(id: string) {
    setRevoking(true);
    try {
      await api(`/devices/${id}/credentials`, { method: "DELETE" });
      setConfirmRevokeId(null);
      await refreshDevices();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't revoke the device");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Settings &amp; agent</h1>
        <p className="text-sm text-muted">Your computers, appearance and account.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Left: devices + pairing ── */}
        <div className="space-y-6 lg:col-span-2">
          <section aria-labelledby="devices-heading" className="space-y-3">
            <h2 id="devices-heading" className="font-semibold">
              Connected devices
            </h2>

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

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Button variant="secondary" disabled title="Key rotation is planned for a later version">
                        Rotate key
                      </Button>

                      {d.status === "REVOKED" ? (
                        <span className="text-sm text-muted">This device&apos;s agent key has been revoked.</span>
                      ) : confirmRevokeId === d.id ? (
                        <>
                          <span className="text-sm">Revoke {d.deviceName}? Its agent will stop working.</span>
                          <Button
                            variant="secondary"
                            className="border-danger text-danger"
                            onClick={() => revokeDevice(d.id)}
                            disabled={revoking}
                          >
                            {revoking ? "Revoking…" : "Yes, revoke"}
                          </Button>
                          <Button variant="secondary" onClick={() => setConfirmRevokeId(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button variant="secondary" className="text-danger" onClick={() => setConfirmRevokeId(d.id)}>
                          Revoke device
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })
            )}
          </section>

          <Card>
            <h2 className="mb-2 font-semibold">Pair a new device</h2>
            <p className="mb-4 text-sm text-muted">
              Run the UpdatePilot agent on a Windows 10/11 computer and enter this code when it asks. Each code works
              once and expires after 10 minutes.
            </p>

            {pairedMessage && (
              <div className="mb-4">
                <Banner tone="success">{pairedMessage}</Banner>
              </div>
            )}
            {pairingError && (
              <div className="mb-4">
                <Banner tone="danger">{pairingError}</Banner>
              </div>
            )}

            {pairing ? (
              <PairingCodeBox
                code={pairing.code}
                expiresAt={pairing.expiresAt}
                onNewCode={generateCode}
                onDone={() => setPairing(null)}
              />
            ) : (
              <Button onClick={generateCode} disabled={generating}>
                {generating ? "Creating code…" : "Generate pairing code"}
              </Button>
            )}
          </Card>
        </div>

        {/* ── Right: appearance, account, privacy ── */}
        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-semibold">Appearance</h2>
            <ThemeChoice />
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Account</h2>
            <div className="mb-4 flex items-center gap-3">
              <Avatar name={user?.displayName ?? ""} size="md" />
              <dl className="min-w-0 space-y-1 text-sm">
                <div>
                  <dt className="sr-only">Name</dt>
                  <dd className="truncate font-medium">{user?.displayName}</dd>
                </div>
                <div>
                  <dt className="sr-only">Email</dt>
                  <dd className="break-all text-muted">{user?.email}</dd>
                </div>
              </dl>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/profile"
                className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-background"
              >
                Edit profile
              </Link>
              <Button variant="secondary" onClick={askLogout}>
                <LogOut size={16} aria-hidden /> Log out
              </Button>
            </div>
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

      {logoutDialog}
    </div>
  );
}

/* ───────────────────────── Theme choice ───────────────────────── */

function ThemeChoice() {
  const theme = useTheme();

  function choose(next: Theme) {
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

/* ───────────────────────── Pairing code box ───────────────────────── */

function PairingCodeBox({
  code,
  expiresAt,
  onNewCode,
  onDone,
}: {
  code: string;
  expiresAt: string;
  onNewCode: () => void;
  onDone: () => void;
}) {
  const [now, setNow] = useState(0); // the real time is set by the timer below, straight away
  const [copied, setCopied] = useState(false);

  // Tick every second for the countdown (first tick right away)
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  // now = 0 means "not ticked yet": show the full 10 minutes instead of "expired"
  const secondsLeft = now ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000)) : 600;
  const expired = secondsLeft === 0;

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the user can still read the code */
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`break-all rounded-md border border-dashed border-border px-4 py-2 font-mono text-2xl tracking-[0.3em] sm:text-3xl ${
            expired ? "text-muted line-through" : ""
          }`}
        >
          {code}
        </span>
        {!expired && (
          <Button variant="secondary" onClick={copy} aria-label={copied ? "Code copied" : "Copy pairing code"}>
            {copied ? "Copied" : "Copy"}
          </Button>
        )}
      </div>

      <p className="text-sm text-muted" aria-live="polite">
        {expired
          ? "This code has expired. Generate a new one."
          : `Expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")} · waiting for the agent…`}
      </p>

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onNewCode}>
          New code
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}