import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, GitBranch, Hash, Layers, Package } from "lucide-react";

import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import {
  DetailTabs,
  isDetailTab,
  type DetailTab,
} from "@/components/data-center/detail-tabs";
import { CategoryActionsBar } from "@/components/data-center/category-actions-bar";
import { buildCategoryTree } from "@/lib/schema";
import { getCategoryTreeFlat } from "@/lib/data/categories";
import { getCurrentRole } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  countSubtreeItems,
  getCategory,
  getCategoryAncestors,
  getCategorySubtreeIds,
  getChildCategories,
  getEffectiveSchema,
} from "@/lib/data/categories";
import { countItems } from "@/lib/data/items";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ categoryId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function TabPlaceholder({ title, phase }: { title: string; phase: string }) {
  return (
    <Card className="border-dashed border-border bg-card/40">
      <CardContent className="flex flex-col items-start gap-1 p-6">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">Built in {phase}.</p>
      </CardContent>
    </Card>
  );
}

export default async function CategoryDetailPage({ params, searchParams }: PageProps) {
  const { categoryId } = await params;
  const query = await searchParams;

  const rawTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const tab: DetailTab = isDetailTab(rawTab) ? rawTab : "overview";

  // A malformed id would make every query below throw; fail fast.
  const category = await getCategory(categoryId).catch(() => null);
  if (!category) notFound();

  const [ancestors, children, effective, directItems, subtreeItems, subtreeIds, flatTree, role] =
    await Promise.all([
      getCategoryAncestors(categoryId),
      getChildCategories(categoryId),
      getEffectiveSchema(categoryId),
      countItems(categoryId),
      countSubtreeItems(categoryId),
      getCategorySubtreeIds(categoryId),
      getCategoryTreeFlat(),
      getCurrentRole(),
    ]);

  const tree = buildCategoryTree(flatTree);
  const canEdit = role === "SCHEMA_ADMIN";

  // get_category_ancestors returns root-first with the target last.
  const chain = ancestors.map((node) => ({ id: node.id, name: node.name }));
  const parent = ancestors.find((node) => node.depth === 1) ?? null;

  const ownFields = effective.filter((field) => !field.inherited);
  const inheritedFields = effective.filter((field) => field.inherited);
  const overriddenCount = effective.filter((f) => f.overridden_by?.includes(category.id)).length;
  const descendantCount = Math.max(0, subtreeIds.length - 1);

  return (
    <div className="flex min-h-full flex-col">
      {/* Header */}
      <header className="space-y-3 px-6 pb-4 pt-6">
        <Breadcrumbs chain={chain} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
              {category.name}
            </h1>
            {category.description && (
              <p className="max-w-2xl text-sm text-muted-foreground">{category.description}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canEdit && (
              <CategoryActionsBar
                category={category}
                tree={tree}
                descendantCount={descendantCount}
                subtreeItemCount={subtreeItems}
                variant="header"
              />
            )}
            <span className="rounded border border-border px-2 py-1 font-mono text-xs text-muted-foreground">
              /{category.slug}
            </span>
          </div>
        </div>
      </header>

      <DetailTabs categoryId={category.id} active={tab} itemCount={directItems} />

      <div className="flex-1 p-6">
        {tab === "overview" && (
          <div className="space-y-6">
            {/* Summary */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="border-border/50 bg-card">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Effective fields
                  </CardTitle>
                  <Layers className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-foreground">{effective.length}</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {inheritedFields.length} inherited · {ownFields.length} own
                    {overriddenCount > 0 && ` · ${overriddenCount} overridden here`}
                  </p>
                </CardContent>
              </Card>

              <Card className="border-border/50 bg-card">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Items</CardTitle>
                  <Package className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-foreground">{directItems}</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {subtreeItems} including descendants
                  </p>
                </CardContent>
              </Card>

              <Card className="border-border/50 bg-card">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Children
                  </CardTitle>
                  <GitBranch className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-foreground">{children.length}</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {descendantCount} in the whole subtree
                  </p>
                </CardContent>
              </Card>

              <Card className="border-border/50 bg-card">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Parent</CardTitle>
                  <Hash className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  {parent ? (
                    <Link
                      href={`/data-center/${parent.id}`}
                      className="text-lg font-semibold text-foreground hover:text-primary hover:underline"
                    >
                      {parent.name}
                    </Link>
                  ) : (
                    <div className="text-lg font-semibold text-muted-foreground">Root category</div>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {chain.length} level{chain.length === 1 ? "" : "s"} from the root
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Children */}
            {children.length > 0 && (
              <Card className="border-border/50 bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-foreground">
                    Direct children
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {children.map((child) => (
                    <Link
                      key={child.id}
                      href={`/data-center/${child.id}`}
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-foreground">{child.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {child.own_fields?.length ?? 0} own field
                          {(child.own_fields?.length ?? 0) === 1 ? "" : "s"}
                          {Object.keys(child.overrides ?? {}).length > 0 &&
                            ` · ${Object.keys(child.overrides).length} override${
                              Object.keys(child.overrides).length === 1 ? "" : "s"
                            }`}
                        </span>
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </Link>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Metadata */}
            <Card className="border-border/50 bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-foreground">Details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Slug</dt>
                    <dd className="font-mono text-sm text-foreground">{category.slug}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Position</dt>
                    <dd className="text-sm text-foreground">{category.position}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Created</dt>
                    <dd className="text-sm text-foreground">
                      {new Date(category.created_at).toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Last updated</dt>
                    <dd className="text-sm text-foreground">
                      {new Date(category.updated_at).toLocaleString()}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            {/* Danger zone */}
            <Card className="border-destructive/30 bg-destructive/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-destructive">Danger zone</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-4">
                <p className="max-w-md text-sm text-muted-foreground">
                  Deleting this category also deletes everything beneath it — descendant
                  categories and all of their items.
                </p>
                <CategoryActionsBar
                  category={category}
                  tree={tree}
                  descendantCount={descendantCount}
                  subtreeItemCount={subtreeItems}
                  variant="danger"
                />
              </CardContent>
            </Card>
          </div>
        )}

        {tab === "schema" && (
          <TabPlaceholder
            title="Schema composition editor"
            phase="Phase 3"
          />
        )}
        {tab === "items" && <TabPlaceholder title="Items workspace" phase="Phase 4" />}
        {tab === "history" && (
          <TabPlaceholder title="Schema version history" phase="Phase 5" />
        )}
      </div>
    </div>
  );
}
