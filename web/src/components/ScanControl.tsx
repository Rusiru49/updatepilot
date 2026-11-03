"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Banner, Button } from "./ui";

type ScanStatus = { state: string; appsFound: number | null; errorSummary: string | null };

export function ScanControl({
  deviceId,
  deviceName,
  online,
  activeScanId,
  onFinished,
}: {
  deviceId: string;
  deviceName: string;
  online: boolean;
  activeScanId: string | null;
  onFinished: () => void;
}) {
  const [scanId, setScanId] = useState<string | null>(activeScanId);
  const [state, setState] = useState<string | null>(activeScanId ? "QUEUED" : null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function start() {
    setStarting(true);
    setError(null);
    setResult(null);
    try {
      const res = await api<{ scanJobId: string; state: string }>(`/devices/${deviceId}/scans`, { method: "POST" });
      setScanId(res.scanJobId);
      setState(res.state);
    } catch (err) {
      const existing = (err as ApiError)?.details as { scanJobId?: string } | undefined;
      if (err instanceof ApiError && err.code === "SCAN_IN_PROGRESS" && existing?.scanJobId) {
        setScanId(existing.scanJobId); // follow the scan that's already running
        setState("QUEUED");
      } else {
        setError(err instanceof ApiError ? err.message : "Couldn't start the scan");
      }
    } finally {
      setStarting(false);
    }
  }

  // Check progress every 2 s while a scan is running
  useEffect(() => {
    if (!scanId) return;
    let cancelled = false;

    const timer = setInterval(async () => {
      try {
        const s = await api<ScanStatus>(`/scans/${scanId}`);
        if (cancelled) return;
        setState(s.state);
        if (s.state === "SUCCEEDED") {
          setScanId(null);
          setResult(`Scan complete: ${s.appsFound ?? 0} apps found.`);
          onFinished();
        } else if (s.state === "FAILED" || s.state === "CANCELLED") {
          setScanId(null);
          setError(s.errorSummary ?? "The scan failed.");
        }
      } catch {
        /* temporary problem — keep checking */
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [scanId, onFinished]);

  return (
    <div className="space-y-3">
      {scanId ? (
        <div role="status" className="flex items-center gap-2 text-sm">
          <Loader2 size={16} className="animate-spin text-primary" aria-hidden />
          {state === "QUEUED" ? "Waiting for the agent to pick up the scan…" : "Scanning installed apps…"}
        </div>
      ) : (
        <>
          <p className="text-sm text-muted">
            {online
              ? "Run a new scan to refresh installed versions and available updates."
              : `The agent on ${deviceName} is offline. Start it on that computer, then scan.`}
          </p>
          <Button onClick={start} disabled={!online || starting}>
            {starting ? "Starting…" : "Scan now"}
          </Button>
        </>
      )}
      {result && <Banner tone="success">{result}</Banner>}
      {error && <Banner tone="danger">{error}</Banner>}
    </div>
  );
}