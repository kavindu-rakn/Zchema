import Link from "next/link";
import { FolderX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function DashboardNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="flex flex-col items-center gap-4 text-center max-w-md">
        <div className="rounded-full bg-zinc-900 p-4 border border-zinc-800">
          <FolderX className="h-6 w-6 text-zinc-500" />
        </div>
        <h2 className="text-xl font-semibold text-zinc-100">Not found</h2>
        <p className="text-sm text-zinc-400">
          The page or resource you&apos;re looking for doesn&apos;t exist or has
          been removed.
        </p>
        <Link
          href="/dashboard"
          className={
            buttonVariants({ variant: "outline" }) +
            " mt-2 border-zinc-800 hover:bg-zinc-800 hover:text-zinc-100"
          }
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
