import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function CategoryNotFound() {
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-12 text-center">
      <FileQuestion className="mx-auto h-8 w-8 text-muted-foreground" />
      <h1 className="mt-4 font-heading text-lg font-semibold text-foreground">
        Category not found
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        It may have been deleted, or deleted along with a parent category — removing a category
        removes everything beneath it.
      </p>
      <Link
        href="/data-center"
        className="mx-auto mt-6 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Back to the Data Center
      </Link>
    </div>
  );
}
