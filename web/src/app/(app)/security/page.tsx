"use client";

import { ShieldCheck } from "lucide-react";
import { usePageTitle } from "@/lib/usePageTitle";

export default function SecurityPage() {
  usePageTitle("Security insights");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Security insights</h1>

      <div className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-start gap-3">
          <ShieldCheck size={24} className="mt-0.5 shrink-0 text-primary" aria-hidden />
          <div className="space-y-3 text-sm">
            <p className="font-semibold">Not available in this version</p>
            <p className="text-muted">
              UpdatePilot only shows a vulnerability when it can be verified for the exact app and version you have
              installed. Free vulnerability databases don&apos;t yet match Windows (WinGet) packages reliably, so
              instead of guessing, this page stays empty.
            </p>
            <p className="text-muted">
              Planned: verified advisories from the NIST National Vulnerability Database for common apps, showing the
              source, severity, affected versions and the date checked.
            </p>
            <p className="text-muted">
              Until then, the safest step is to keep apps up to date on the <a href="/updates" className="font-semibold text-primary hover:underline">Updates</a> page.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}