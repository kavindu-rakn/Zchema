"use client";

// ── "You have unsaved changes from earlier" ──────────────────
// Keeps an editor's work in sessionStorage across an in-app
// navigation, and offers it back on the way in.
//
// Offered, not restored silently. An item form can fold a draft back
// into its fields unasked — it is the same item, and the fields are in
// front of you. A schema is different: the draft may be days old, the
// saved schema may have moved on since, and quietly showing edits
// nobody asked for as though they were the saved state is how someone
// applies a change they did not mean to make. So the editor renders a
// bar, and the user chooses.
//
// The stored value is read through useSyncExternalStore rather than in
// an effect: on the server there is no storage, so the server snapshot
// is null and React re-renders with the real one after hydration —
// no mismatch, and no state written during an effect.

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { clearDraft, peekDraft, subscribeToDrafts, writeDraft } from "@/lib/drafts";

export interface Draft<T> {
  /**
   * A draft that was already waiting when this editor mounted, or null
   * — once this editor has saved one of its own, or the user has
   * answered, there is nothing left to offer.
   */
  offered: T | null;
  /** Keep the current work, replacing anything stored. */
  save: (value: T) => void;
  /** Throw the stored draft away. */
  forget: () => void;
  /** Stop offering it without deleting it — the user took it. */
  dismiss: () => void;
}

export function useDraft<T>(key: string): Draft<T> {
  const raw = useSyncExternalStore(
    subscribeToDrafts,
    () => peekDraft(key),
    () => null
  );

  // Our own writes land in the same slot. Once we have made one, what
  // is in storage is this session's work, not an earlier visit's.
  const [mine, setMine] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const offered = useMemo<T | null>(() => {
    if (mine || dismissed || raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }, [raw, mine, dismissed]);

  const save = useCallback(
    (value: T) => {
      writeDraft(key, value);
      setMine(true);
    },
    [key]
  );

  const forget = useCallback(() => {
    clearDraft(key);
    setDismissed(true);
  }, [key]);

  const dismiss = useCallback(() => setDismissed(true), []);

  return { offered, save, forget, dismiss };
}
