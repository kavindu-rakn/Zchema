import Link from "next/link";
import { FolderX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function DashboardNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="rounded-full border border-border bg-card p-4">
          <FolderX className="h-6 w-6 text-muted-foreground" />
        </div>

        <h2 className="text-xl font-semibold text-foreground">Not found</h2>
        <p className="text-sm text-muted-foreground">
          The page or resource you&apos;re looking for doesn&apos;t exist or has been removed.
        </p>

        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Link href="/data-center" className={cn(buttonVariants({ variant: "outline" }))}>
            Go to Data Center
          </Link>
          <Link href="/dashboard" className={cn(buttonVariants({ variant: "ghost" }))}>
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
