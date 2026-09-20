// ── Unsaved editor drafts ────────────────────────────────────
// Work that exists nowhere but the browser until it is saved: a
// half-filled item form, a schema the user has been rearranging for
// ten minutes. `beforeunload` covers a reload or a closed tab, but the
// App Router has no route-change guard, so clicking a category in the
// sidebar used to take the draft with it.
//
// Drafts live in sessionStorage: per tab, gone when the tab closes,
// never sent anywhere. Every accessor here is total — storage can be
// full, blocked by the browser, or absent on the server, and an editor
// must keep working in all three cases.
//
// Writes notify subscribers so a component can tell, without polling,
// that a draft is waiting for it (see use-draft.ts).

type Listener = () => void;

const listeners = new Set<Listener>();

function storage(): Storage | null {
  try {
    // Absent on the server; throws outright when site data is blocked.
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

/**
 * Namespaced, so one editor cannot read another's draft — and so a
 * stray key in sessionStorage is identifiable at a glance.
 */
export function draftKey(kind: string, id: string): string {
  return `zchema:draft:${kind}:${id}`;
}

/** The raw stored string, for a caller that wants to compare snapshots. */
export function peekDraft(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** The parsed draft, or null when there is none or it is corrupt. */
export function readDraft<T>(key: string): T | null {
  const raw = peekDraft(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeDraft(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage blocked. Editing still works; the
    // draft simply will not survive leaving the page.
  }
  notify();
}

export function clearDraft(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Nothing to clean up.
  }
  notify();
}

/** Subscribe to every draft write, for useSyncExternalStore. */
export function subscribeToDrafts(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
