"use client";

// Scoped BELOW the Data Center layout on purpose: a category whose
// schema or items fail to load keeps the tree rail alive beside it, so
// the user can simply click another node.

import { PaneError } from "@/components/pane-error";

export default function CategoryDetailError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <PaneError error={error} retry={unstable_retry} what="this category" />;
}
