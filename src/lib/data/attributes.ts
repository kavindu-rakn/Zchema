// ── Attribute registry queries ───────────────────────────────
// Unlike blueprints, an attribute IS a live link: a category's
// own_fields entry carries `attribute_id`, edits to the attribute's
// presentation propagate down, and that back-link is what makes
// cross-category search possible at all.

import { createClient } from "@/utils/supabase/server";
import type {
  Attribute,
  AttributeUsage,
  AttributeWithUsage,
  DuplicateFieldDefinition,
} from "@/lib/types";

/** Every attribute, with how many categories and items it reaches. */
export async function getAttributesWithUsage(): Promise<AttributeWithUsage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_attributes_with_usage");

  if (error) throw new Error(`Could not load attributes: ${error.message}`);
  return (data ?? []) as AttributeWithUsage[];
}

/** A single attribute by id. */
export async function getAttribute(id: string): Promise<Attribute> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attributes")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error(`Could not load that attribute: ${error.message}`);
  return data as Attribute;
}

/** Every category using an attribute, with its item counts. */
export async function getAttributeUsage(id: string): Promise<AttributeUsage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_attribute_usage", {
    p_attribute_id: id,
  });

  if (error) throw new Error(`Could not load attribute usage: ${error.message}`);
  return (data ?? []) as AttributeUsage[];
}

/**
 * Field keys defined on several categories with nothing linking them.
 *
 * This is how the registry gets populated. Asking someone to model
 * their attributes before they have data produces an empty library;
 * showing them "you have written `brand` three times" produces a full
 * one.
 */
export async function getDuplicateFieldDefinitions(): Promise<DuplicateFieldDefinition[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("find_duplicate_field_definitions");

  if (error) throw new Error(`Could not scan for duplicate fields: ${error.message}`);
  return (data ?? []) as DuplicateFieldDefinition[];
}
