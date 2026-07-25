import { fetchTemplates, deleteTemplate } from './actions'
import { Card, CardHeader, CardTitle, CardDescription, CardFooter, CardContent } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { Plus, FileText, Calendar, SlidersHorizontal } from 'lucide-react'
import { createClient } from '@/utils/supabase/server'
import { DeleteTemplateButton } from './delete-template-button'

export const dynamic = 'force-dynamic'

export default async function TemplatesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user!.id).single()
  const isAdmin = profile?.role === 'TEMPLATE_ADMIN'

  const templates = await fetchTemplates()

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Templates</h1>
          <p className="text-muted-foreground">Manage your dynamic catalog templates.</p>
        </div>
        {isAdmin && (
          <Link href="/templates/new" className={buttonVariants({ variant: "default" }) + " bg-emerald-600 hover:bg-emerald-700 text-white"}>
            <Plus className="mr-2 h-4 w-4" />
            Create Template
          </Link>
        )}
      </div>

      {templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border rounded-xl border-dashed bg-zinc-950/50">
          <div className="rounded-full bg-zinc-900 p-3 mb-4">
            <FileText className="h-6 w-6 text-zinc-400" />
          </div>
          <h2 className="text-xl font-semibold mb-2">No templates yet</h2>
          <p className="text-zinc-400 mb-6 max-w-md">
            Create your first template to start defining the structure of your catalog items.
          </p>
          {isAdmin && (
            <Link href="/templates/new" className={buttonVariants({ variant: "outline" })}>
              <Plus className="mr-2 h-4 w-4" />
              Create Template
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {templates.map((template) => (
            <Card key={template.id} className="bg-zinc-950 border-zinc-800 flex flex-col hover:border-zinc-700 transition-colors">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-xl text-zinc-100">{template.name}</CardTitle>
                  <Badge variant="secondary" className="text-[11px] bg-zinc-900 border border-zinc-800 text-zinc-400 shrink-0">
                    <SlidersHorizontal className="h-3 w-3 mr-1" />
                    {template.fields.length} {template.fields.length === 1 ? 'field' : 'fields'}
                  </Badge>
                </div>
                <CardDescription className="text-zinc-400 line-clamp-2">
                  {template.description || 'No description provided.'}
                </CardDescription>
              </CardHeader>
              <CardFooter className="mt-auto flex justify-between items-center text-sm text-zinc-500 border-t border-zinc-900 pt-4">
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>{new Date(template.created_at).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center gap-2">
                  {isAdmin && <DeleteTemplateButton templateId={template.id} templateName={template.name} />}
                  <Link href={`/templates/${template.id}`} className={buttonVariants({ variant: "ghost", size: "sm" }) + " hover:bg-zinc-800"}>
                    {isAdmin ? 'Edit' : 'View'}
                  </Link>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

