import { Layers } from 'lucide-react'

import { getBlueprintsWithUsage } from '@/lib/data/blueprints'

export const dynamic = 'force-dynamic'

// Successor to /templates. The framing matters more than the list: the
// single most likely misunderstanding of the new model is thinking a
// blueprint stays linked to the categories that used it.

export default async function BlueprintsPage() {
  const blueprints = await getBlueprintsWithUsage()

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-6 py-12">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-primary">
          <Layers className="h-5 w-5" />
          <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground">
            Blueprints
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Reusable starting points. Applying a blueprint copies its fields onto a category;
          there is no live link afterwards.
        </p>
      </div>

      <div className="mt-6 rounded-md border border-border bg-card/40 p-4">
        {blueprints.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No blueprints yet. Create one from the list, or save a category&apos;s fields as a
            blueprint from its Schema tab — that is usually the easier way round.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Pick a blueprint from the list to edit its fields or apply it to a category.
          </p>
        )}
      </div>
    </div>
  )
}
