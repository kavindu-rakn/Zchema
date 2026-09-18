import Link from "next/link";

import { LogoMark } from "@/components/brand/logo-mark";

// Any URL no route matches. The dashboard has its own not-found for
// missing categories; this one catches everything else.
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <LogoMark className="h-10 w-10 text-primary" />
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">There is nothing at this address.</p>
      <Link href="/" className="text-sm text-primary transition-colors hover:text-primary/80">
        Back to Zchema
      </Link>
    </main>
  );
}
