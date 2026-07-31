"use client";

// ── Motion policy ────────────────────────────────────────────
// framer-motion does not consult prefers-reduced-motion on its own —
// it has to be told. `reducedMotion="user"` makes every transform and
// layout animation in the tree respect the OS setting, which matters
// here because the schema editor and blueprint builder are both
// drag-to-reorder surfaces and motion sensitivity is a real condition,
// not a preference.

import { MotionConfig } from "framer-motion";

export function Motion({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
