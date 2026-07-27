import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getBlueprints } from '@/lib/data/blueprints'

export const dynamic = 'force-dynamic'

// Successor to /templates. Blueprints are optional starter presets now,
// so this is a light list; the editor is rebuilt in Phase 3.

export default async function BlueprintsPage() {
  const blueprints = await getBlueprints()

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight text-zinc-100">Blueprints</h2>
      </div>

      <Card className="border-zinc-800 bg-zinc-950 text-zinc-100 shadow-sm">
        <CardHeader>
          <CardTitle>Starter presets</CardTitle>
          <CardDescription className="text-zinc-400">
            Blueprints are optional. Applying one copies its fields into a category&apos;s own
            fields — there is no live link afterwards. The editor is rebuilt in Phase 3.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {blueprints.length === 0 ? (
            <p className="text-sm text-zinc-500">No blueprints yet.</p>
          ) : (
            <ul className="space-y-2">
              {blueprints.map((blueprint) => (
                <li
                  key={blueprint.id}
                  className="flex items-center justify-between rounded-md border border-zinc-800 px-3 py-2"
                >
                  <span className="text-sm text-zinc-200">{blueprint.name}</span>
                  <span className="text-xs text-zinc-500">
                    {blueprint.fields?.length ?? 0} fields
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
