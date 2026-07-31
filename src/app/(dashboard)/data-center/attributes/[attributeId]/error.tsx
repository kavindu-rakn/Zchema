"use client";

import { PaneError } from "@/components/pane-error";

export default function AttributeDetailError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PaneError {...props} what="this attribute" />;
}
