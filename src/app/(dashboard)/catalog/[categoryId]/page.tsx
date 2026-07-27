import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// The per-category items view is rebuilt on the effective schema in
// Phase 4 (dynamic form + data table driven by get_effective_schema).

interface CatalogPageProps {
  params: Promise<{ categoryId: string }>;
}

export default async function CatalogCategoryPage({ params }: CatalogPageProps) {
  const { categoryId } = await params;

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight text-zinc-100">Items</h2>
      </div>

      <Card className="border-zinc-800 bg-zinc-950 text-zinc-100 shadow-sm">
        <CardHeader>
          <CardTitle>Rebuilt in Phase 2</CardTitle>
          <CardDescription className="text-zinc-400">
            Items for category <code className="text-zinc-300">{categoryId}</code> will render
            against the category&apos;s effective schema once the workspace is rebuilt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-500">Rebuilt in Phase 2.</p>
        </CardContent>
      </Card>
    </div>
  );
}
