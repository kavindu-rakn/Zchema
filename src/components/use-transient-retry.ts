"use client";

// ── One quiet retry, for errors that deserve one ─────────────
// An expired or freshly-rotated token takes down a whole page, where
// fetching again a moment later just works. The boundaries call this
// so the user sees a brief "Reconnecting…" instead of an error they
// can do nothing about.

import { useEffect, useState } from "react";

import { isTransientError } from "@/lib/transient";

/**
 * How recently an automatic retry ran, module-scope on purpose: a retry
 * that fails again may REMOUNT the boundary, and a per-instance guard
 * would let that turn into a loop.
 */
let lastAutoRetry = 0;
const COOLDOWN_MS = 15_000;

/** True while a retry is pending; the caller renders "Reconnecting…". */
export function useTransientRetry(message: string | undefined, retry: () => void): boolean {
  const [retrying] = useState(
    () => isTransientError(message) && Date.now() - lastAutoRetry > COOLDOWN_MS
  );

  useEffect(() => {
    if (!retrying) return;
    lastAutoRetry = Date.now();
    // A short pause: an instant retry tends to hit the same bad moment.
    const timer = setTimeout(retry, 500);
    return () => clearTimeout(timer);
  }, [retrying, retry]);

  return retrying;
}
