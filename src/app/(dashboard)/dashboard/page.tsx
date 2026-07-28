import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Database,
  FolderTree,
  GitCompare,
  Layers,
  Plus,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardData } from "@/lib/data/dashboard";

export const dynamic = "force-dynamic";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default async function DashboardPage() {
  const { shape, schemaChanges7d, attention, activity } = await getDashboardData();

  const stats = [
    {
      title: "Categories",
      value: shape.categories.toLocaleString(),
      subtitle: `${shape.rootCategories} root · max depth ${shape.maxDepth}`,
      icon: FolderTree,
    },
    {
      title: "Schema fields",
      value: shape.authoredFields.toLocaleString(),
      subtitle: `${shape.inheritedSlots} inherited across the tree`,
      icon: Layers,
    },
    {
      title: "Items",
      value: shape.items.toLocaleString(),
      subtitle: "Across all categories",
      icon: Database,
    },
    {
      title: "Schema changes",
      value: schemaChanges7d.toLocaleString(),
      subtitle: "In the last 7 days",
      icon: GitCompare,
    },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* ── Hero: the front door ───────────────────────────── */}
      <Card className="border-primary/20 bg-gradient-to-br from-card to-primary/5 shadow-sm">
        <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Boxes className="h-5 w-5 text-primary" />
              <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
                Data Center
              </h1>
            </div>
            <p className="text-sm text-muted-foreground">
              {shape.categories} categories · {shape.maxDepth} level
              {shape.maxDepth === 1 ? "" : "s"} deep · {shape.items.toLocaleString()} items ·{" "}
              {shape.authoredFields} fields defined
            </p>
          </div>

          <Link
            href="/data-center"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Enter Data Center
            <ArrowRight className="h-4 w-4" />
          </Link>
        </CardContent>
      </Card>

      {/* ── Shape of the catalogue ─────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card
            key={stat.title}
            className="border-border/50 bg-card shadow-sm transition-all duration-200 hover:border-primary/20 hover:shadow-md"
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{stat.value}</div>
              <p className="mt-1 text-xs text-muted-foreground">{stat.subtitle}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Needs attention (only when non-empty) ────────── */}
        {attention.length > 0 && (
          <Card className="border-border/50 bg-card shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
                <AlertTriangle className="h-4 w-4 text-primary" />
                Needs attention
              </CardTitle>
              <span className="text-xs text-muted-foreground">{attention.length}</span>
            </CardHeader>
            <CardContent className="space-y-1">
              {attention.slice(0, 6).map((entry) => (
                <Link
                  key={`${entry.kind}-${entry.categoryId}`}
                  href={entry.href}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-foreground">
                      {entry.categoryName}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {entry.detail}
                    </span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </Link>
              ))}
              {attention.length > 6 && (
                <p className="px-2 pt-1 text-xs text-muted-foreground">
                  and {attention.length - 6} more
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Recent activity ──────────────────────────────── */}
        <Card className="border-border/50 bg-card shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <div className="flex flex-col items-start gap-3 py-2">
                <p className="text-sm text-muted-foreground">
                  Nothing yet. Create a category and give it some fields to get started.
                </p>
                <Link
                  href="/data-center"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New category
                </Link>
              </div>
            ) : (
              <ol className="space-y-1">
                {activity.map((entry) => (
                  <li key={`${entry.kind}-${entry.id}`}>
                    <Link
                      href={entry.href}
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {entry.kind === "schema_change" ? (
                          <GitCompare className="h-3.5 w-3.5 shrink-0 text-primary" />
                        ) : (
                          <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-foreground">
                            {entry.title}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {entry.detail}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {relativeTime(entry.at)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
