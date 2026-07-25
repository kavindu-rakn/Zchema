'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { deleteTemplate } from './actions'
import { toast } from 'sonner'

interface DeleteTemplateButtonProps {
  templateId: string
  templateName: string
}

export function DeleteTemplateButton({ templateId, templateName }: DeleteTemplateButtonProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const router = useRouter()

  const handleDelete = async () => {
    if (!confirm(`Delete template "${templateName}"? This cannot be undone. Categories using this template will not be deleted, but they will have no associated template.`)) return
    setIsDeleting(true)
    try {
      await deleteTemplate(templateId)
      toast.success(`Template "${templateName}" deleted`)
      router.refresh()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete template')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleDelete}
      disabled={isDeleting}
      className="h-8 px-2 text-red-400 hover:text-red-300 hover:bg-red-950/30"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  )
}
