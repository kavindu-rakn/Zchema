"use client";

import { PaneError } from "@/components/pane-error";

export default function SearchError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <PaneError error={error} retry={unstable_retry} what="these results" />;
}
