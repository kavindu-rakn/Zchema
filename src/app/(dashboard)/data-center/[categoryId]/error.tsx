"use client";

// Scoped BELOW the Data Center layout on purpose: a category whose
// schema or items fail to load keeps the tree rail alive beside it, so
// the user can simply click another node.

import { PaneError } from "@/components/pane-error";

export default function CategoryDetailError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PaneError {...props} what="this category" />;
}
