"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { User } from "@/lib/types";
import { useAuth } from "@/components/AuthProvider";
import { Banner, Button } from "@/components/ui";

const inputClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft aria-[invalid=true]:border-danger";

type FieldErrors = Partial<Record<"displayName" | "email" | "password" | "confirmPassword", string>>;

export default function RegisterPage() {
  const { user, loading, setUser } = useAuth();
  const router = useRouter();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already logged in? Go to the dashboard.
  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  // Quick checks in the browser (the server checks again)
  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!displayName.trim()) errors.displayName = "Enter your name";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = "Enter a valid email address";
    if (password.length < 8) errors.password = "Use at least 8 characters";
    else if (password.length > 72) errors.password = "Use 72 characters or fewer";
    if (confirmPassword !== password) errors.confirmPassword = "Passwords don't match";
    return errors;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const res = await api<{ user: User }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ displayName: displayName.trim(), email: email.trim(), password }),
      });
      setUser(res.user); // the server already logged us in (session cookie)
      router.replace("/");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "EMAIL_TAKEN") {
          setFieldErrors({ email: "An account with this email already exists" });
        } else if (err.code === "VALIDATION_ERROR" && Array.isArray(err.details)) {
          // Show server validation messages next to the right fields
          const serverErrors: FieldErrors = {};
          for (const d of err.details as { field: string; issue: string }[]) {
            serverErrors[d.field as keyof FieldErrors] = d.issue;
          }
          setFieldErrors(serverErrors);
        } else {
          setError(err.message);
        }
      } else {
        setError("Something went wrong");
      }
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
        <h1 className="text-xl font-bold">Create an account</h1>
        <p className="mb-6 mt-1 text-sm text-muted">Start keeping your Windows apps up to date.</p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {error && <Banner tone="danger">{error}</Banner>}

          <Field id="displayName" label="Name" error={fieldErrors.displayName}>
            <input
              id="displayName"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              aria-invalid={!!fieldErrors.displayName}
              aria-describedby={fieldErrors.displayName ? "displayName-error" : undefined}
              className={inputClass}
            />
          </Field>

          <Field id="email" label="Email" error={fieldErrors.email}>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!fieldErrors.email}
              aria-describedby={fieldErrors.email ? "email-error" : undefined}
              className={inputClass}
            />
          </Field>

          <Field id="password" label="Password" error={fieldErrors.password} hint="At least 8 characters">
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!fieldErrors.password}
              aria-describedby={fieldErrors.password ? "password-error" : "password-hint"}
              className={inputClass}
            />
          </Field>

          <Field id="confirmPassword" label="Confirm password" error={fieldErrors.confirmPassword}>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-invalid={!!fieldErrors.confirmPassword}
              aria-describedby={fieldErrors.confirmPassword ? "confirmPassword-error" : undefined}
              className={inputClass}
            />
          </Field>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}