export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const ACTIVITY_LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.register": "Account created",
  "seed.sample_data_created": "Sample data loaded",
  "scan.completed": "Scan completed",
  "update.succeeded": "Update succeeded",
  "update.failed": "Update failed",
  "update.restart_required": "Update needs a restart",
  "update.cancelled": "Update cancelled",
};

export const activityLabel = (eventType: string) => ACTIVITY_LABELS[eventType] ?? eventType;

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// Only allow safe https links from data (never "javascript:" etc.)
export function safeUrl(url: string | null | undefined) {
  return url && url.startsWith("https://") ? url : null;
}