'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { Category, Template } from '@/lib/types'

export async function fetchCategories() {
  const supabase = await createClient()
  
  const [categoriesRes, templatesRes] = await Promise.all([
    supabase.from('categories').select('*').order('name'),
    supabase.from('templates').select('*').order('name')
  ])

  if (categoriesRes.error) throw new Error(categoriesRes.error.message)
  if (templatesRes.error) throw new Error(templatesRes.error.message)

  return {
    categories: categoriesRes.data as Category[],
    templates: templatesRes.data as Template[]
  }
}

export async function createCategory(data: { name: string; parent_id?: string | null; template_id: string }) {
  const supabase = await createClient()
  
  const { error } = await supabase.from('categories').insert([
    {
      name: data.name,
      parent_id: data.parent_id || null,
      template_id: data.template_id
    }
  ])

  if (error) throw new Error(error.message)
  
  revalidatePath('/categories')
}

export async function updateCategory(id: string, data: { name?: string; parent_id?: string | null; template_id?: string }) {
  const supabase = await createClient()
  
  const { error } = await supabase.from('categories').update({
    name: data.name,
    parent_id: data.parent_id,
    template_id: data.template_id,
  }).eq('id', id)

  if (error) throw new Error(error.message)
  
  revalidatePath('/categories')
}

export async function deleteCategory(id: string) {
  const supabase = await createClient()
  
  const { error } = await supabase.from('categories').delete().eq('id', id)

  if (error) throw new Error(error.message)
  
  revalidatePath('/categories')
}
