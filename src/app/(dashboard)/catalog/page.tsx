import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// The items workspace is rebuilt on the effective schema in Phase 4.

export default function CatalogPage() {
  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight text-zinc-100">Catalog</h2>
      </div>

      <Card className="border-zinc-800 bg-zinc-950 text-zinc-100 shadow-sm">
        <CardHeader>
          <CardTitle>Rebuilt in Phase 2</CardTitle>
          <CardDescription className="text-zinc-400">
            Catalog and Categories merge into a single tree workspace; the items table is rebuilt
            on each category&apos;s effective schema in Phase 4.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-500">Rebuilt in Phase 2.</p>
        </CardContent>
      </Card>
    </div>
  )
}
