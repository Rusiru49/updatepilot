// What WinGet / installer exit codes mean, in plain words.
// "restart" = installed, but Windows must restart to finish.
export type ExitInfo = { outcome: "ok" | "restart" | "failed"; message: string };

const failed = (message: string): ExitInfo => ({ outcome: "failed", message });
const restart = (message: string): ExitInfo => ({ outcome: "restart", message });

// Keys are the unsigned 32-bit value of the exit code.
// 0x8A15xxxx values are WinGet's own codes; small numbers come from the installer (MSI / Windows).
const CODES: Record<number, ExitInfo> = {
  0: { outcome: "ok", message: "Installed successfully" },

  3010: restart("Installed, but Windows needs a restart to finish"),
  1641: restart("The installer started a Windows restart"),
  0x8a150109: restart("Installed, but Windows needs a restart to finish"),
  0x8a15010a: restart("Windows needs a restart before this update can install"),
  0x8a15010b: restart("The installer started a Windows restart"),

  1602: failed("The update was cancelled"),
  1223: failed("The update was cancelled (administrator approval may have been declined)"),
  0x8a15010c: failed("The update was cancelled"),
  740: failed("The update needs administrator approval"),
  1603: failed("The installer failed (often because the app is running). Close the app and try again"),
  0x8a150101: failed("The app is running. Close it and try again"),
  0x8a150111: failed("The app is in use by another program. Close it and try again"),
  0x8a150103: failed("A file is in use. Close the app and try again"),
  1618: failed("Another installation is in progress. Wait for it to finish and try again"),
  0x8a150102: failed("Another installation is in progress. Wait for it to finish and try again"),
  0x8a150105: failed("Not enough disk space"),
  0x8a150107: failed("No internet connection"),
  0x8a15010f: failed("Blocked by your organisation's policy"),
  0x80073d02: failed("The app is open. Close it and try again"), // Store (MSIX) app in use
  0x8a15002b: failed("WinGet found no applicable update (the app may already be up to date)"),
  0x8a150014: failed("WinGet couldn't find this package"),
};

// Show small codes as numbers (1603) and WinGet codes as hex (0x8A150101)
export function formatExitCode(code: number | null): string {
  if (code === null) return "none";
  return code >= 0 && code <= 0xffff ? String(code) : `0x${(code >>> 0).toString(16).toUpperCase()}`;
}

export function describeExitCode(code: number | null): ExitInfo {
  if (code === null) return failed("WinGet stopped without an exit code");
  return CODES[code >>> 0] ?? failed(`WinGet failed (exit code ${formatExitCode(code)})`);
}