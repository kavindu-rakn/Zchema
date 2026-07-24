'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { Template } from '@/lib/types'

export async function fetchTemplates() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching templates:', error)
    return []
  }

  return data as Template[]
}

export async function fetchTemplate(id: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('Error fetching template:', error)
    return null
  }

  return data as Template
}

export async function createTemplate(data: Partial<Template>) {
  const supabase = await createClient()
  
  // ensure user is logged in
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { data: result, error } = await supabase
    .from('templates')
    .insert([{ ...data, user_id: user.id }])
    .select()
    .single()

  if (error) {
    console.error('Error creating template:', error)
    throw new Error(error.message)
  }

  revalidatePath('/templates')
  return result
}

export async function updateTemplate(id: string, data: Partial<Template>) {
  const supabase = await createClient()
  const { data: result, error } = await supabase
    .from('templates')
    .update(data)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Error updating template:', error)
    throw new Error(error.message)
  }

  revalidatePath('/templates')
  revalidatePath(`/templates/${id}`)
  return result
}

export async function deleteTemplate(id: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('templates')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Error deleting template:', error)
    throw new Error(error.message)
  }

  revalidatePath('/templates')
}
