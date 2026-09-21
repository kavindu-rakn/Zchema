"use client";

// ── "You have unsaved changes" ───────────────────────────────
// The schema editor and the blueprint builder hold work that exists
// nowhere else until it is saved. This asks the browser to confirm
// before a reload, a tab close, or a link off the site.
//
// It cannot cover navigation WITHIN the app: the App Router has no
// route-change guard, and Link's onNavigate would have to be threaded
// through every link on screen. Both editors say "Unsaved changes" next
// to their Save button for that case.

import { useEffect } from "react";

export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;

    const confirmLeave = (event: BeforeUnloadEvent) => {
      // Browsers show their own wording; preventDefault is what asks.
      event.preventDefault();
    };

    window.addEventListener("beforeunload", confirmLeave);
    return () => window.removeEventListener("beforeunload", confirmLeave);
  }, [dirty]);
}
