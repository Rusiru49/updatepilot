"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import type { User } from "@/lib/types";
import { usePageTitle } from "@/lib/usePageTitle";
import { useAuth } from "@/components/AuthProvider";
import { Banner, Button } from "@/components/ui";

const inputClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft aria-[invalid=true]:border-danger";

export default function LoginPage() {
  usePageTitle("Sign in");
  const { user, loading, setUser } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already logged in? Go to the dashboard.
  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Say what's missing instead of silently disabling the button
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await api<{ user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setUser(res.user);
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8">
        <div className="mb-6 flex items-center gap-2 text-lg font-extrabold text-primary">
          <span className="h-7 w-7 rounded-md bg-primary" aria-hidden />
          UpdatePilot
        </div>
        <h1 className="text-xl font-bold">Sign in</h1>
        <p className="mb-6 mt-1 text-sm text-muted">Keep your Windows apps up to date, safely.</p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* role="alert" makes screen readers read the error as soon as it appears */}
          <div role="alert" id="login-error">
            {error && <Banner tone="danger">{error}</Banner>}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              aria-invalid={!!error}
              aria-describedby={error ? "login-error" : undefined}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={!!error}
              aria-describedby={error ? "login-error" : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          New to UpdatePilot?{" "}
          <Link href="/register" className="font-semibold text-primary hover:underline">
            Create an account
          </Link>
        </p>

        {/* Shown only while developing — never in a production build */}
        {process.env.NODE_ENV !== "production" && (
          <p className="mt-6 text-xs text-muted">Sample account: demo@updatepilot.local / Demo@12345</p>
        )}
      </div>
    </main>
  );
}