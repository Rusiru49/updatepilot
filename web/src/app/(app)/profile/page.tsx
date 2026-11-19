"use client";

import { useState, type FormEvent } from "react";
import { LogOut } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { User } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { usePageTitle } from "@/lib/usePageTitle";
import { useAuth } from "@/components/AuthProvider";
import { Avatar } from "@/components/Avatar";
import { useLogout } from "@/components/useLogout";
import { Banner, Button, Card } from "@/components/ui";

const inputClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft sm:text-sm disabled:opacity-60";

export default function ProfilePage() {
  usePageTitle("Profile");
  const { user } = useAuth();
  const { askLogout, logoutDialog } = useLogout();
  if (!user) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <Avatar name={user.displayName} size="lg" />
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold">{user.displayName}</h1>
          <p className="break-all text-sm text-muted">{user.email}</p>
          {user.createdAt && <p className="text-sm text-muted">Member since {formatDate(user.createdAt)}</p>}
        </div>
      </header>

      <DetailsCard key={user.displayName} />
      <PasswordCard />

      <Card>
        <h2 className="mb-2 font-semibold">Session</h2>
        <p className="mb-4 text-sm text-muted">Log out of UpdatePilot on this browser.</p>
        <Button variant="secondary" onClick={askLogout}>
          <LogOut size={16} aria-hidden /> Log out
        </Button>
      </Card>

      {logoutDialog}
    </div>
  );
}

/* ── Your details: change the display name ── */
function DetailsCard() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.displayName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (!name.trim()) {
      setError("Enter your name.");
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ user: User }>("/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ displayName: name }),
      });
      setUser(res.user);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your name");
    } finally {
      setSaving(false);
    }
  }

  const unchanged = name.trim() === (user?.displayName ?? "");

  return (
    <Card>
      <h2 className="mb-4 font-semibold">Your details</h2>
      <form onSubmit={save} className="space-y-4" noValidate>
        <div role="alert" id="details-error">
          {error && <Banner tone="danger">{error}</Banner>}
        </div>
        <div aria-live="polite">{saved && <Banner tone="success">Your name was saved.</Banner>}</div>

        <div className="space-y-1.5">
          <label htmlFor="displayName" className="text-sm font-medium">Name</label>
          <input
            id="displayName"
            name="name"
            autoComplete="name"
            maxLength={50}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            aria-invalid={!!error}
            aria-describedby={error ? "details-error" : undefined}
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium">Email</label>
          <input id="email" value={user?.email ?? ""} disabled readOnly className={inputClass} aria-describedby="email-hint" />
          <p id="email-hint" className="text-xs text-muted">Your email is your sign-in name and can&apos;t be changed in this version.</p>
        </div>

        <Button type="submit" disabled={saving || unchanged}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </form>
    </Card>
  );
}

/* ── Change password ── */
function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function change(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    if (!current || !next || !confirm) {
      setError("Fill in all three password fields.");
      return;
    }
    if (next !== confirm) {
      setError("The new passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ ok: true; otherSessionsEnded: number }>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(
        res.otherSessionsEnded > 0
          ? `Password changed. You were signed out of ${res.otherSessionsEnded} other session${res.otherSessionsEnded === 1 ? "" : "s"}.`
          : "Password changed.",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't change your password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 font-semibold">Change password</h2>
      <p className="mb-4 text-sm text-muted">
        Changing your password signs you out everywhere else, but keeps you signed in here.
      </p>
      <form onSubmit={change} className="space-y-4" noValidate>
        <div role="alert" id="password-error">
          {error && <Banner tone="danger">{error}</Banner>}
        </div>
        <div aria-live="polite">{done && <Banner tone="success">{done}</Banner>}</div>

        <div className="space-y-1.5">
          <label htmlFor="currentPassword" className="text-sm font-medium">Current password</label>
          <input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            aria-describedby={error ? "password-error" : undefined}
            className={inputClass}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="newPassword" className="text-sm font-medium">New password</label>
          <input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            aria-describedby={error ? "password-error" : undefined}
            className={inputClass}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="confirmPassword" className="text-sm font-medium">Confirm new password</label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-describedby={error ? "password-error" : undefined}
            className={inputClass}
          />
        </div>

        <Button type="submit" disabled={saving}>
          {saving ? "Changing…" : "Change password"}
        </Button>
      </form>
    </Card>
  );
}