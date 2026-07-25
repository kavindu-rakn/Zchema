import { fetchCategories } from './actions'
import { CategoryTree } from '@/components/category-tree'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

export default async function CategoriesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user!.id).single()

  const { categories, templates } = await fetchCategories()

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight text-zinc-100">Categories</h2>
      </div>
      
      <Card className="border-zinc-800 bg-zinc-950 text-zinc-100 shadow-sm">
        <CardHeader>
          <CardTitle>Catalog Hierarchy</CardTitle>
          <CardDescription className="text-zinc-400">
            Manage your product categories, subcategories, and linked templates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CategoryTree categories={categories} templates={templates} userRole={profile?.role ?? 'VIEWER'} />
        </CardContent>
      </Card>
    </div>
  )
}

