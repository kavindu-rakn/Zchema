'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Category, Template, CategoryNode, UserRole } from '@/lib/types'
import { createCategory, updateCategory, deleteCategory } from '@/app/(dashboard)/categories/actions'
import { Folder, FolderOpen, Plus, MoreVertical, Edit2, Trash2, FileJson, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'

interface CategoryTreeProps {
  categories: Category[]
  templates: Template[]
  userRole: UserRole
}


export function CategoryTree({ categories, templates, userRole }: CategoryTreeProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null)
  
  const [formData, setFormData] = useState({ name: '', template_id: '' })
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Build tree
  const tree = useMemo(() => {
    const map = new Map<string, CategoryNode>()
    const roots: CategoryNode[] = []

    categories.forEach(c => {
      map.set(c.id, { ...c, children: [] })
    })

    categories.forEach(c => {
      if (c.parent_id && map.has(c.parent_id)) {
        map.get(c.parent_id)!.children.push(map.get(c.id)!)
      } else {
        roots.push(map.get(c.id)!)
      }
    })

    return roots
  }, [categories])

  const handleOpenAddDialog = (parentId: string | null = null) => {
    setSelectedParentId(parentId)
    setFormData({ name: '', template_id: '' })
    setEditingCategory(null)
    setIsAddDialogOpen(true)
  }

  const handleOpenEditDialog = (category: Category) => {
    setEditingCategory(category)
    setFormData({ name: category.name, template_id: category.template_id })
    setIsAddDialogOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      if (editingCategory) {
        await updateCategory(editingCategory.id, {
          name: formData.name,
          template_id: formData.template_id
        })
        toast.success('Category updated')
      } else {
        await createCategory({
          name: formData.name,
          parent_id: selectedParentId,
          template_id: formData.template_id
        })
        toast.success('Category created')
      }
      setIsAddDialogOpen(false)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save category')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this category? All subcategories will also be deleted.')) {
      try {
        await deleteCategory(id)
        toast.success('Category deleted')
      } catch (error: any) {
        toast.error(error?.message || 'Failed to delete category')
      }
    }
  }

  const TreeNode = ({ node, level = 0 }: { node: CategoryNode, level?: number }) => {
    const [isOpen, setIsOpen] = useState(false)
    const hasChildren = node.children.length > 0
    const template = templates.find(t => t.id === node.template_id)

    const isAdmin = userRole === 'TEMPLATE_ADMIN'

    return (
      <div className="flex flex-col">
        <div 
          className="flex items-center justify-between py-2 px-3 hover:bg-zinc-800/50 rounded-md group transition-colors"
          style={{ paddingLeft: `${level * 1.5 + 0.75}rem` }}
        >
          <div className="flex items-center gap-3 cursor-pointer select-none" onClick={() => setIsOpen(!isOpen)}>
            {hasChildren ? (
              isOpen ? <FolderOpen className="h-4 w-4 text-emerald-400" /> : <Folder className="h-4 w-4 text-emerald-400" />
            ) : (
              <Folder className="h-4 w-4 text-zinc-500" />
            )}
            <span className="text-sm font-medium text-zinc-200">{node.name}</span>
            {template && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-xs text-zinc-400">
                <FileJson className="h-3 w-3" />
                {template.name}
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* View Items — visible to everyone */}
            <Link
              href={`/catalog/${node.id}`}
              className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-emerald-400 px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
              onClick={e => e.stopPropagation()}
            >
              <ArrowRight className="h-3 w-3" />
              View Items
            </Link>

            {/* Admin-only actions */}
            {isAdmin && (
              <>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-emerald-400" onClick={() => handleOpenAddDialog(node.id)}>
                  <Plus className="h-4 w-4" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 w-8 text-zinc-400 hover:text-zinc-200 rounded-md transition-colors">
                    <MoreVertical className="h-4 w-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40 border-zinc-800 bg-zinc-950 text-zinc-200">
                    <DropdownMenuItem onClick={() => handleOpenEditDialog(node)} className="focus:bg-zinc-800 focus:text-zinc-100 cursor-pointer">
                      <Edit2 className="mr-2 h-4 w-4" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDelete(node.id)} className="text-red-400 focus:bg-red-950/50 focus:text-red-400 cursor-pointer">
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </div>

        <AnimatePresence initial={false}>
          {isOpen && hasChildren && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              {node.children.map(child => (
                <TreeNode key={child.id} node={child} level={level + 1} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-medium text-zinc-100">Category Structure</h3>
        {userRole === 'TEMPLATE_ADMIN' && (
          <Button onClick={() => handleOpenAddDialog(null)} className="bg-emerald-500 hover:bg-emerald-600 text-white">
            <Plus className="h-4 w-4 mr-2" />
            Add Root Category
          </Button>
        )}
      </div>

      <div className="border border-zinc-800 rounded-lg bg-zinc-900/50 p-2 min-h-[300px]">
        {tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[200px] text-zinc-500">
            <Folder className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">No categories found.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {tree.map(node => (
              <TreeNode key={node.id} node={node} />
            ))}
          </div>
        )}
      </div>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[425px] bg-zinc-950 border-zinc-800 text-zinc-100">
          <DialogHeader>
            <DialogTitle>{editingCategory ? 'Edit Category' : 'Add Category'}</DialogTitle>
            <DialogDescription className="text-zinc-400">
              {editingCategory ? 'Update the details for this category.' : 'Create a new category in your catalog.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-zinc-300">Name</Label>
              <Input 
                id="name" 
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Laptops"
                className="bg-zinc-900 border-zinc-800 focus-visible:ring-emerald-500"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template" className="text-zinc-300">Template</Label>
              <Select 
                value={formData.template_id} 
                onValueChange={v => setFormData({ ...formData, template_id: v || '' })}
                required
              >
                <SelectTrigger id="template" className="bg-zinc-900 border-zinc-800 focus:ring-emerald-500">
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-950 border-zinc-800 text-zinc-200">
                  {templates.map(t => (
                    <SelectItem key={t.id} value={t.id} className="focus:bg-zinc-800 focus:text-zinc-100">
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="pt-4">
              <Button type="button" variant="ghost" onClick={() => setIsAddDialogOpen(false)} className="hover:bg-zinc-800 text-zinc-300">
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} className="bg-emerald-500 hover:bg-emerald-600 text-white">
                {isSubmitting ? 'Saving...' : 'Save Category'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
