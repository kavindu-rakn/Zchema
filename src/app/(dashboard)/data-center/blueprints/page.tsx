import { Layers } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getBlueprints } from '@/lib/data/blueprints'

export const dynamic = 'force-dynamic'

// Successor to /templates. Blueprints are optional starter presets now,
// so the framing matters more than the list: the single most likely
// misunderstanding of the new model is thinking they stay linked.
// The editor is rebuilt in Phase 3.

export default async function BlueprintsPage() {
  const blueprints = await getBlueprints()

  return (
    <div className="p-6">
      <header className="mb-6 space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
          Blueprints
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Reusable starting points. Applying a blueprint copies its fields onto a category;
          there is no live link afterwards.
        </p>
      </header>

      {blueprints.length === 0 ? (
        <Card className="border-dashed border-border bg-card/40">
          <CardContent className="flex flex-col items-start gap-1 p-6">
            <p className="text-sm font-medium text-foreground">No blueprints yet</p>
            <p className="text-sm text-muted-foreground">
              Blueprints are optional — a category can define its fields directly.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {blueprints.map((blueprint) => (
            <Card key={blueprint.id} className="border-border/50 bg-card">
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-foreground">
                  {blueprint.name}
                </CardTitle>
                <Layers className="h-4 w-4 shrink-0 text-primary" />
              </CardHeader>
              <CardContent className="space-y-3">
                {blueprint.description && (
                  <p className="text-sm text-muted-foreground">{blueprint.description}</p>
                )}
                <div className="flex flex-wrap gap-1">
                  {(blueprint.fields ?? []).slice(0, 6).map((field) => (
                    <span
                      key={field.key}
                      className="rounded border border-border bg-secondary/40 px-1.5 py-0.5 font-mono text-[11px] text-secondary-foreground"
                    >
                      {field.key}
                    </span>
                  ))}
                  {(blueprint.fields?.length ?? 0) > 6 && (
                    <span className="px-1 py-0.5 text-[11px] text-muted-foreground">
                      +{(blueprint.fields?.length ?? 0) - 6} more
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {blueprint.fields?.length ?? 0} field
                  {(blueprint.fields?.length ?? 0) === 1 ? '' : 's'}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
