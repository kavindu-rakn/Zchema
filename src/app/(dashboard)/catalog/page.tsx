import { createClient } from '@/utils/supabase/server'
import Link from 'next/link'
import { Database, FolderOpen, ChevronRight, Tag } from 'lucide-react'
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export const dynamic = 'force-dynamic'

interface CategoryWithCounts {
  id: string
  name: string
  parent_id: string | null
  template_id: string
  template_name: string
  item_count: number
}

async function fetchCatalogOverview(): Promise<CategoryWithCounts[]> {
  const supabase = await createClient()

  // Fetch all categories joined with template name
  const { data: categories, error } = await supabase
    .from('categories')
    .select('id, name, parent_id, template_id, templates(name)')
    .order('name')

  if (error || !categories) return []

  // Fetch item counts per category
  const { data: itemCounts } = await supabase
    .from('items')
    .select('category_id')

  const countMap = new Map<string, number>()
  if (itemCounts) {
    for (const item of itemCounts) {
      countMap.set(item.category_id, (countMap.get(item.category_id) ?? 0) + 1)
    }
  }

  return categories.map((c: any) => ({
    id: c.id,
    name: c.name,
    parent_id: c.parent_id,
    template_id: c.template_id,
    template_name: c.templates?.name ?? 'Unknown',
    item_count: countMap.get(c.id) ?? 0,
  }))
}

export default async function CatalogPage() {
  const categories = await fetchCatalogOverview()

  // Split into root and children for display
  const rootCategories = categories.filter(c => !c.parent_id)
  const childCategories = categories.filter(c => c.parent_id)

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-100">Catalog</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Browse categories and view their items.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Database className="h-4 w-4" />
          <span>{categories.length} {categories.length === 1 ? 'category' : 'categories'}</span>
        </div>
      </div>

      {categories.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed border-zinc-800 rounded-xl bg-zinc-950/50">
          <div className="rounded-full bg-zinc-900 p-4 mb-4 border border-zinc-800">
            <FolderOpen className="h-6 w-6 text-zinc-500" />
          </div>
          <h2 className="text-lg font-semibold text-zinc-200 mb-2">No categories yet</h2>
          <p className="text-zinc-500 text-sm max-w-sm">
            Create categories in the{' '}
            <Link href="/categories" className="text-emerald-400 hover:underline">
              Categories
            </Link>{' '}
            section and link them to a template to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Root categories */}
          {rootCategories.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3 pl-1">
                Top-level categories
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {rootCategories.map(category => (
                  <CategoryCard key={category.id} category={category} />
                ))}
              </div>
            </section>
          )}

          {/* Sub-categories */}
          {childCategories.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3 pl-1">
                Subcategories
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {childCategories.map(category => (
                  <CategoryCard key={category.id} category={category} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function CategoryCard({ category }: { category: CategoryWithCounts }) {
  return (
    <Link href={`/catalog/${category.id}`} className="block group">
      <Card className="bg-zinc-950 border-zinc-800 hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-900/10 transition-all duration-200 h-full flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                <FolderOpen className="h-4 w-4 text-emerald-400" />
              </div>
              <CardTitle className="text-base text-zinc-100 group-hover:text-emerald-300 transition-colors leading-tight">
                {category.name}
              </CardTitle>
            </div>
            <ChevronRight className="h-4 w-4 text-zinc-600 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all mt-1 shrink-0" />
          </div>
        </CardHeader>

        <CardContent className="pb-3 flex-1">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <Tag className="h-3 w-3" />
            <span>{category.template_name}</span>
          </div>
        </CardContent>

        <CardFooter className="pt-3 border-t border-zinc-900">
          <Badge
            variant="secondary"
            className="text-[11px] bg-zinc-900 text-zinc-400 border-zinc-800 border"
          >
            {category.item_count} {category.item_count === 1 ? 'item' : 'items'}
          </Badge>
        </CardFooter>
      </Card>
    </Link>
  )
}
