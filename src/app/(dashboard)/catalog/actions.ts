"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { Category, Item, Template } from "@/lib/types";

export async function fetchCategoryWithTemplate(categoryId: string) {
  const supabase = await createClient();

  // Fetch category
  const { data: category, error: categoryError } = await supabase
    .from("categories")
    .select("*, template:templates(*)")
    .eq("id", categoryId)
    .single();

  if (categoryError) throw new Error(categoryError.message);
  
  return {
    category: category as Category,
    template: category.template as Template,
  };
}

export async function fetchItems(categoryId: string) {
  const supabase = await createClient();

  const { data: items, error } = await supabase
    .from("items")
    .select("*")
    .eq("category_id", categoryId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return items as Item[];
}

export async function createItem(categoryId: string, data: Record<string, any>) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("items")
    .insert([{ category_id: categoryId, data }]);

  if (error) throw new Error(error.message);

  revalidatePath(`/catalog/${categoryId}`);
}

export async function updateItem(id: string, categoryId: string, data: Record<string, any>) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("items")
    .update({ data })
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath(`/catalog/${categoryId}`);
}

export async function deleteItem(id: string, categoryId: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("items")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath(`/catalog/${categoryId}`);
}
