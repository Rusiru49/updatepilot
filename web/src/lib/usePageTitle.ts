"use client";
import { useEffect } from "react";

// Sets the browser tab title, e.g. "Updates · UpdatePilot"
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · UpdatePilot`;
  }, [title]);
}