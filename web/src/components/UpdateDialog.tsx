"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { UpdatePreview } from "@/lib/types";
import { Modal } from "./Modal";
import { Badge, Banner, Button, Skeleton } from "./ui";

export function UpdateDialog({ applicationId, onClose }: { applicationId: string; onClose: () => void }) {
  const [preview, setPreview] = useState<UpdatePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  // Ask the server to check everything and prepare a one-time preview
  useEffect(() => {
    let cancelled = false;
    api<UpdatePreview>(`/updates/${applicationId}/preview`, { method: "POST" })
      .then((p) => !cancelled && setPreview(p))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Couldn't prepare the update"));
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  // Countdown until the preview expires
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const secondsLeft = preview ? Math.max(0, Math.floor((new Date(preview.expiresAt).getTime() - now) / 1000)) : 0;
  const expired = !!preview && secondsLeft === 0;

  return (
    <Modal
      title="Confirm update"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled title="Installing updates is built in the next step (Week 4, Step 4)">
            Confirm update
          </Button>
        </>
      }
    >
      {error ? (
        <Banner tone="danger">{error}</Banner>
      ) : !preview ? (
        <div className="space-y-3" role="status" aria-label="Checking the update">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-5 w-3/4" />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Review the details below. The UpdatePilot agent on <strong>{preview.device.deviceName}</strong> will run
            this update.
          </p>

          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted">Application</dt>
            <dd className="font-semibold">{preview.application.displayName}</dd>
            <dt className="text-muted">Package ID</dt>
            <dd className="break-all font-mono text-xs leading-5">{preview.application.packageId}</dd>
            <dt className="text-muted">Version</dt>
            <dd className="font-mono text-xs leading-5">
              {preview.fromVersion} → <strong>{preview.targetVersion}</strong>
            </dd>
            <dt className="text-muted">Source</dt>
            <dd>Windows Package Manager (winget)</dd>
            <dt className="text-muted">Computer</dt>
            <dd className="flex items-center gap-2">
              {preview.device.deviceName}
              <Badge tone={preview.device.online ? "success" : "danger"}>
                {preview.device.online ? "Online" : "Offline"}
              </Badge>
            </dd>
          </dl>

          {preview.warnings.length > 0 && (
            <ul className="space-y-2 rounded-lg bg-warning-soft p-4 text-sm text-warning">
              {preview.warnings.map((w) => (
                <li key={w} className="flex gap-2">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-muted">
            {expired
              ? "This confirmation has expired. Close and open it again."
              : `This confirmation is valid for ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}.`}
          </p>
        </div>
      )}
    </Modal>
  );
}