"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Laptop, LogOut, Moon, Sun } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Device } from "@/lib/types";
import { formatDate, timeAgo } from "@/lib/format";
import { useAuth } from "@/components/AuthProvider";
import { Badge, Banner, Button, Card, EmptyState, ErrorState, Skeleton, type Tone } from "@/components/ui";

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
                      <Button variant="secondary" disabled title="Key rotation is built later">
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
            <dl className="mb-4 space-y-2 text-sm">
              <div>
                <dt className="text-muted">Name</dt>
                <dd className="font-medium">{user?.displayName}</dd>
              </div>
              <div>
                <dt className="text-muted">Email</dt>
                <dd className="break-all font-medium">{user?.email}</dd>
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

/* ───────────────────────── Theme choice ───────────────────────── */

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
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);

  // Tick every second for the countdown
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const secondsLeft = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
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
          className={`rounded-md border border-dashed border-border px-4 py-2 font-mono text-2xl tracking-[0.3em] ${
            expired ? "text-muted line-through" : ""
          }`}
        >
          {code}
        </span>
        {!expired && (
          <Button variant="secondary" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
        )}
      </div>

      <p className="text-sm text-muted">
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