// ── Blueprint queries ────────────────────────────────────────
// Blueprints are optional starter presets. Applying one COPIES its
// fields into a category's own_fields — there is no live link, so
// nothing here joins back to categories.

import { createClient } from "@/utils/supabase/server";
import type { Blueprint } from "@/lib/types";

/** Every blueprint, newest first. */
export async function getBlueprints(): Promise<Blueprint[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("blueprints")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw new Error(`Could not load blueprints: ${error.message}`);
  return (data ?? []) as Blueprint[];
}

/** A single blueprint by id. */
export async function getBlueprint(id: string): Promise<Blueprint> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("blueprints")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error(`Could not load that blueprint: ${error.message}`);
  return data as Blueprint;
}
