"use client";

// ── Saved searches ───────────────────────────────────────────
// localStorage, deliberately. A saved search is a personal bookmark,
// not shared state — and since the URL already carries the entire
// query, "sharing" a search is just sending the link.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bookmark, BookmarkCheck, X } from "lucide-react";

const KEY = "schemashift:saved-searches";
const LIMIT = 12;

interface Saved {
  query: string;
  savedAt: number;
}

export function SavedSearches({ currentQuery }: { currentQuery: string }) {
  const [saved, setSaved] = useState<Saved[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Read in a microtask rather than synchronously in the effect body:
  // localStorage is an external store, and this is the shape that says
  // so. It also avoids a flash of the wrong bookmark state.
  useEffect(() => {
    let live = true;
    void (async () => {
      let restored: Saved[] = [];
      try {
        const stored = window.localStorage.getItem(KEY);
        if (stored) restored = JSON.parse(stored) as Saved[];
      } catch {
        restored = [];
      }
      if (!live) return;
      setSaved(restored);
      setHydrated(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  const persist = (next: Saved[]) => {
    setSaved(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Just won't persist.
    }
  };

  const isSaved = saved.some((entry) => entry.query === currentQuery);

  const toggle = () => {
    if (!currentQuery.trim()) return;
    persist(
      isSaved
        ? saved.filter((entry) => entry.query !== currentQuery)
        : [{ query: currentQuery, savedAt: Date.now() }, ...saved].slice(0, LIMIT)
    );
  };

  if (!hydrated) return null;

  return (
    <div className="space-y-2">
      {currentQuery.trim() && (
        <button
          type="button"
          onClick={toggle}
          className="flex w-full items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {isSaved ? (
            <>
              <BookmarkCheck className="h-3.5 w-3.5 text-primary" />
              Saved
            </>
          ) : (
            <>
              <Bookmark className="h-3.5 w-3.5" />
              Save this search
            </>
          )}
        </button>
      )}

      {saved.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Saved
          </h3>
          <ul className="space-y-0.5">
            {saved.map((entry) => (
              <li key={entry.query} className="flex items-center gap-1">
                <Link
                  href={`/search?q=${encodeURIComponent(entry.query)}`}
                  className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-xs text-foreground hover:bg-accent"
                  title={entry.query}
                >
                  {entry.query}
                </Link>
                <button
                  type="button"
                  aria-label={`Remove the saved search ${entry.query}`}
                  onClick={() => persist(saved.filter((other) => other.query !== entry.query))}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
