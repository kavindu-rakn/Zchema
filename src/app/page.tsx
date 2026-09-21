import { ArrowRight, FolderTree, History, ScanSearch } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo-mark";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-12 px-6 py-24">
      {/* ── Hero ── */}
      <div className="flex flex-col items-center gap-4 text-center max-w-2xl">
        <div className="flex items-center gap-2 rounded-full border border-border/60 bg-secondary/50 px-4 py-1.5 text-xs font-medium text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          See what breaks before it breaks
        </div>

        {/* The mark is its own rounded tile now, so it needs no frame
            around it — just the glow the rendered artwork has. */}
        <LogoMark className="mt-2 mb-2 h-20 w-20 text-primary drop-shadow-[0_0_28px_rgba(0,196,131,0.28)]" />

        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
          <span className="text-primary">Z</span>chema
        </h1>

        <p className="max-w-lg text-base text-muted-foreground leading-relaxed">
          Change your data model against live records. Before a schema change
          is applied, Zchema shows exactly which categories, items and values
          it touches — then applies it in one transaction you can roll back.
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
          icon={<ScanSearch className="h-5 w-5 text-primary" />}
          title="Impact before apply"
          description="Every schema change shows its blast radius first: which categories, how many items, and which values won't survive."
        />
        <FeatureCard
          icon={<FolderTree className="h-5 w-5 text-primary" />}
          title="Schemas that inherit"
          description="Fields live on the category and flow down the tree. Children add and override; they never silently lose a field."
        />
        <FeatureCard
          icon={<History className="h-5 w-5 text-primary" />}
          title="Nothing silently lost"
          description="Values from a removed field are kept, not deleted, and every change is versioned so you can roll it back."
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
