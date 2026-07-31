"use server";

// ── Onboarding server actions ────────────────────────────────

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { requireProfile, requireSchemaAdmin } from "@/lib/auth";
import { actionError } from "@/lib/action-result";
import type { ActionResult } from "@/lib/types";

export type SampleDataset = "catalog" | "vehicles";

/**
 * Load a ready-made catalog into an EMPTY workspace.
 *
 * The database function refuses if any category exists. That check
 * lives there rather than here because this is reachable from a button,
 * and a first-run helper that can quietly damage a real catalog is a
 * data-loss bug wearing a friendly hat.
 */
export async function loadSampleCatalog(
  dataset: SampleDataset
): Promise<ActionResult<{ category_id: string }>> {
  try {
    await requireSchemaAdmin();

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("seed_sample_catalog", {
      p_dataset: dataset,
    });

    if (error) throw new Error(error.message);

    revalidatePath("/data-center", "layout");
    revalidatePath("/dashboard");
    return { ok: true, data: data as { category_id: string } };
  } catch (error) {
    return actionError(error, "Could not load the sample catalog.");
  }
}

/** Permanently hide one hint for the current user. */
export async function dismissHint(key: string): Promise<ActionResult> {
  try {
    await requireProfile();

    const supabase = await createClient();
    const { error } = await supabase.rpc("dismiss_onboarding_hint", { p_key: key });
    if (error) throw new Error(error.message);

    revalidatePath("/data-center", "layout");
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, "Could not save that preference.");
  }
}

/** Hints this user has already dismissed. */
export async function getDismissedHints(): Promise<string[]> {
  const profile = await requireProfile().catch(() => null);
  if (!profile) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("onboarding_state")
    .eq("id", profile.id)
    .maybeSingle();

  const state = (data?.onboarding_state ?? {}) as { dismissed?: string[] };
  return Array.isArray(state.dismissed) ? state.dismissed : [];
}
