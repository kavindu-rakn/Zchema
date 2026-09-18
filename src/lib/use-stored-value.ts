// ── Browser-storage values as an external store ──────────────
// localStorage only exists in the browser, so a component that reads it
// during its first render disagrees with the server's markup. The old
// fix — read it in an effect after mount, then setState — renders twice
// and is what React's compiler rules now reject. useSyncExternalStore is
// the purpose-built answer: during hydration it uses the server snapshot
// (`undefined` here, meaning "not known yet"), then re-renders with the
// stored value.
//
// Writes go through writeStoredValue so every reader of that key updates.
// They also land in an in-memory overlay first, so where storage is
// blocked (some private modes) the UI still responds — it just won't
// persist, which is what the effect-based code did too. The browser's
// own `storage` event keeps other tabs in step.

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Map<string, Set<() => void>>();
const overlay = new Map<string, string | null>();

function notify(key: string) {
  listeners.get(key)?.forEach((listener) => listener());
}

/** The current value for `key`: `null` when nothing is stored. Browser only. */
export function readStoredValue(key: string): string | null {
  if (overlay.has(key)) return overlay.get(key) ?? null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** A stored JSON array of strings, or `null` if absent or malformed. */
export function parseStoredList(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : null;
  } catch {
    return null;
  }
}

/** Store (or, with `null`, remove) a value and re-render every reader. */
export function writeStoredValue(key: string, value: string | null) {
  overlay.set(key, value);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — the overlay keeps this tab consistent.
  }
  notify(key);
}

/**
 * The stored string for `key`: `null` when absent, `undefined` until the
 * component has hydrated. Treat `undefined` as "render the server default".
 */
export function useStoredValue(key: string): string | null | undefined {
  const subscribe = useCallback(
    (listener: () => void) => {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(listener);

      // Another tab changed it: drop any stale overlay and re-read.
      const onStorage = (event: StorageEvent) => {
        if (event.key !== key) return;
        overlay.delete(key);
        listener();
      };
      window.addEventListener("storage", onStorage);

      return () => {
        set.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
    [key]
  );

  return useSyncExternalStore(
    subscribe,
    () => readStoredValue(key),
    () => undefined
  );
}
