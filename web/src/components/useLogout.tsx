"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { Modal } from "./Modal";
import { Button } from "./ui";

// Usage: const { askLogout, logoutDialog } = useLogout();
//        <button onClick={askLogout}>Log out</button> {logoutDialog}
export function useLogout() {
  const { logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    await logout();
    router.replace("/login");
  }

  const logoutDialog = open ? (
    <Modal
      title="Log out of UpdatePilot?"
      onClose={() => !busy && setOpen(false)}
      footer={
        <>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy}>
            {busy ? "Logging out…" : "Log out"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">
        You&apos;ll need to sign in again to use the dashboard. The agent on your computers keeps running.
      </p>
    </Modal>
  ) : null;

  return { askLogout: () => setOpen(true), logoutDialog };
}