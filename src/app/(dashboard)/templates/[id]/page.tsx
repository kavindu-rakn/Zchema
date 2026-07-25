import { fetchTemplate, createTemplate, updateTemplate } from '../actions'
import { TemplateBuilder } from '@/components/template-builder'
import { redirect } from 'next/navigation'
import { Template } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const isNew = id === 'new'
  let template: Template | null = null

  if (!isNew) {
    template = await fetchTemplate(id)
    if (!template) {
      redirect('/templates')
    }
  }

  const handleSave = async (data: Partial<Template>) => {
    'use server'
    if (isNew) {
      await createTemplate(data)
    } else {
      await updateTemplate(id, data)
    }
    redirect('/templates')
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {isNew ? 'Create Template' : 'Edit Template'}
        </h1>
        <p className="text-muted-foreground">
          {isNew ? 'Define the fields for your new template.' : 'Modify your existing template structure.'}
        </p>
      </div>

      <div className="mt-4">
        <TemplateBuilder initialData={template} onSave={handleSave} />
      </div>
    </div>
  )
}

