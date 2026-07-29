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

export interface BlueprintWithUsage extends Blueprint {
  /**
   * How many categories were started from this blueprint.
   * Provenance only — `blueprint_id` records where a category's fields
   * came from originally; it is NOT a live link, and editing the
   * blueprint changes nothing downstream.
   */
  used_by_count: number;
}

/** Every blueprint, with how many categories started from it. */
export async function getBlueprintsWithUsage(): Promise<BlueprintWithUsage[]> {
  const supabase = await createClient();

  const [blueprintRes, usageRes] = await Promise.all([
    supabase.from("blueprints").select("*").order("name", { ascending: true }),
    supabase.from("categories").select("blueprint_id").not("blueprint_id", "is", null),
  ]);

  if (blueprintRes.error) throw new Error(`Could not load blueprints: ${blueprintRes.error.message}`);
  if (usageRes.error) throw new Error(`Could not load blueprint usage: ${usageRes.error.message}`);

  const counts = new Map<string, number>();
  for (const row of (usageRes.data ?? []) as { blueprint_id: string }[]) {
    counts.set(row.blueprint_id, (counts.get(row.blueprint_id) ?? 0) + 1);
  }

  return ((blueprintRes.data ?? []) as Blueprint[]).map((blueprint) => ({
    ...blueprint,
    used_by_count: counts.get(blueprint.id) ?? 0,
  }));
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
