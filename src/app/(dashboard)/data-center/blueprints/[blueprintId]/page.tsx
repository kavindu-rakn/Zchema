import { notFound } from "next/navigation";
import Link from "next/link";

import { BlueprintBuilder } from "@/components/blueprints/blueprint-builder";
import { BlueprintActions } from "@/components/blueprints/blueprint-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getBlueprint, getBlueprintsWithUsage } from "@/lib/data/blueprints";
import { getCategoryTreeFlat, getCategories } from "@/lib/data/categories";
import { buildCategoryTree } from "@/lib/schema";
import { getCurrentRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ blueprintId: string }>;
}

export default async function BlueprintDetailPage({ params }: PageProps) {
  const { blueprintId } = await params;

  const blueprint = await getBlueprint(blueprintId).catch(() => null);
  if (!blueprint) notFound();

  const [flatTree, categories, withUsage, role] = await Promise.all([
    getCategoryTreeFlat(),
    getCategories(),
    getBlueprintsWithUsage(),
    getCurrentRole(),
  ]);

  const canEdit = role === "SCHEMA_ADMIN";
  const tree = buildCategoryTree(flatTree);
  const usedByCount = withUsage.find((b) => b.id === blueprint.id)?.used_by_count ?? 0;
  const startedFrom = categories.filter((c) => c.blueprint_id === blueprint.id);

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground">
            {blueprint.name}
          </h1>
          {blueprint.description && (
            <p className="max-w-2xl text-sm text-muted-foreground">{blueprint.description}</p>
          )}
        </div>
        {canEdit && (
          <BlueprintActions
            blueprintId={blueprint.id}
            blueprintName={blueprint.name}
            usedByCount={usedByCount}
            tree={tree}
          />
        )}
      </header>

      {/* Provenance — explicitly not a live link */}
      <Card className="border-border/50 bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-foreground">
            {usedByCount === 0
              ? "Not used as a starting point yet"
              : `Used as a starting point by ${usedByCount} categor${
                  usedByCount === 1 ? "y" : "ies"
                }`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {startedFrom.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {startedFrom.map((category) => (
                <Link
                  key={category.id}
                  href={`/data-center/${category.id}`}
                  className="rounded border border-border px-2 py-0.5 text-xs text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {category.name}
                </Link>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            That is a record of where their fields came from, not a live link. Editing this
            blueprint does not change any category.
          </p>
        </CardContent>
      </Card>

      {/* Fields */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">Fields</h2>
          <span className="text-xs text-muted-foreground">
            {blueprint.fields?.length ?? 0} field
            {(blueprint.fields?.length ?? 0) === 1 ? "" : "s"}
          </span>
        </div>
        <BlueprintBuilder blueprint={blueprint} canEdit={canEdit} />
      </section>
    </div>
  );
}
