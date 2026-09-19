import Link from "next/link";
import { Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";

/** The rail's way into the trash, styled to sit beside "Import data". */
export function TrashLink({ active = false }: { active?: boolean }) {
  return (
    <Link
      href="/data-center/trash"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-accent text-foreground" : "text-muted-foreground"
      )}
    >
      <Trash2 className="h-3.5 w-3.5" />
      Trash
    </Link>
  );
}
