"use client";

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

// Components that want to know when the theme changes
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The real theme is the data-theme attribute on <html> (set before the page shows, so no flash)
function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

// On the server there's no <html> yet, so assume light
function getServerSnapshot(): Theme {
  return "light";
}

// Change the theme everywhere at once, and remember it
export function setTheme(next: Theme) {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("up-theme", next);
  } catch {
    /* storage blocked — theme still changes for this visit */
  }
  listeners.forEach((l) => l());
}

// Use in any component: const theme = useTheme();
export function useTheme() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}