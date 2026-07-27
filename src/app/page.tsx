import { ArrowRight, Layers, FolderTree, Database } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-12 px-6 py-24">
      {/* ── Hero ── */}
      <div className="flex flex-col items-center gap-4 text-center max-w-2xl">
        <div className="flex items-center gap-2 rounded-full border border-border/60 bg-secondary/50 px-4 py-1.5 text-xs font-medium text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          Dynamic Catalog Engine
        </div>

        <Image src="/logo-nobg.png" alt="SchemaShift Logo" width={80} height={80} className="rounded-2xl shadow-xl border border-border/20 mt-2 mb-2" priority />

        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
          Schema
          <span className="text-primary">Shift</span>
        </h1>

        <p className="max-w-lg text-base text-muted-foreground leading-relaxed">
          A metadata-driven dynamic catalog. Define templates, organize
          hierarchical categories, and populate items with auto-generated forms
          — all powered by JSONB.
        </p>

        <div className="flex items-center gap-3 mt-4">
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-all hover:shadow-md hover:shadow-primary/20"
          >
            Get Started
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-5 py-2.5 text-sm font-medium text-foreground hover:bg-secondary/60 transition-all"
          >
            Log In
          </Link>
        </div>
      </div>

      {/* ── Feature Cards ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 max-w-3xl w-full">
        <FeatureCard
          icon={<Layers className="h-5 w-5 text-primary" />}
          title="Dynamic Templates"
          description="Define custom field schemas with string, number, boolean, date, and select types."
        />
        <FeatureCard
          icon={<FolderTree className="h-5 w-5 text-primary" />}
          title="Category Hierarchy"
          description="Organize items in nested parent-child category trees linked to templates."
        />
        <FeatureCard
          icon={<Database className="h-5 w-5 text-primary" />}
          title="JSONB Catalog"
          description="Store and query dynamic item data with GIN-indexed JSONB for blazing performance."
        />
      </div>

      {/* ── Footer Badge ── */}
      <p className="text-xs text-muted-foreground/50 tracking-wide">
        Built with Next.js · Supabase · shadcn/ui
      </p>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="group flex flex-col gap-3 rounded-xl border border-border/60 bg-card/50 p-5 transition-all hover:border-primary/30 hover:bg-card/80 hover:shadow-lg hover:shadow-primary/5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 group-hover:bg-primary/15 transition-colors">
        {icon}
      </div>
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {description}
      </p>
    </div>
  );
}
