"use client";

import { PaneError } from "@/components/pane-error";

export default function SearchError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PaneError {...props} what="these results" />;
}
