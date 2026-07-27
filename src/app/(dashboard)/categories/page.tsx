import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Phase 1 rewrote the data model; the tree UI is rebuilt in Phase 2/3
// as the Data Center workspace. Intentionally a placeholder.

export default function CategoriesPage() {
  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight text-zinc-100">Categories</h2>
      </div>

      <Card className="border-zinc-800 bg-zinc-950 text-zinc-100 shadow-sm">
        <CardHeader>
          <CardTitle>Rebuilt in Phase 2</CardTitle>
          <CardDescription className="text-zinc-400">
            Categories now own their schema and compose it down the tree. This page becomes the
            Data Center master–detail workspace in the next phase.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-500">Rebuilt in Phase 2.</p>
        </CardContent>
      </Card>
    </div>
  )
}
