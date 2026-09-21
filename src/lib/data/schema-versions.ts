// ── Schema version history queries ───────────────────────────
// The append-only audit trail written by apply_schema_change().
// Typed Supabase helpers; every function returns typed data or throws
// with a message fit for a toast.

import { createClient } from "@/utils/supabase/server";
import type { SchemaVersion } from "@/lib/types";

/** A version row with the author resolved to something displayable. */
export interface SchemaVersionEntry extends SchemaVersion {
  author_email: string | null;
}

/**
 * Every recorded version for a category, newest first.
 *
 * `changed_by` references auth.users, which PostgREST cannot join to
 * public.profiles automatically, so authors are resolved in a second
 * query. A VIEWER only sees their own profile under RLS, so an author
 * they cannot read comes back null and renders as "—" rather than
 * failing the whole timeline.
 */
export async function getSchemaVersions(categoryId: string): Promise<SchemaVersionEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("schema_versions")
    .select("*")
    .eq("category_id", categoryId)
    .order("version", { ascending: false });

  if (error) throw new Error(`Could not load version history: ${error.message}`);

  const versions = (data ?? []) as SchemaVersion[];
  const authorIds = [...new Set(versions.map((v) => v.changed_by).filter(Boolean))] as string[];

  const emails = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", authorIds);
    for (const profile of (profiles ?? []) as { id: string; email: string }[]) {
      emails.set(profile.id, profile.email);
    }
  }

  return versions.map((version) => ({
    ...version,
    author_email: version.changed_by ? emails.get(version.changed_by) ?? null : null,
  }));
}

export interface StaleItems {
  /** Highest recorded version, or 0 when nothing has been applied yet. */
  currentVersion: number;
  /** Items on this category written against an older version. */
  staleCount: number;
  /** The oldest version any item is still sitting on, when stale. */
  oldestVersion: number | null;
}

/**
 * The category's latest recorded schema version, or 0 before its first.
 * The schema editor sends this back with a save, so the database can
 * refuse one that would overwrite a change made in the meantime.
 */
export async function getCurrentSchemaVersion(categoryId: string): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("schema_versions")
    .select("version")
    .eq("category_id", categoryId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Could not read the current version: ${error.message}`);
  return (data?.version as number | undefined) ?? 0;
}

/**
 * How far the item data has drifted behind the schema.
 *
 * `items.schema_version` is only bumped on items a migration actually
 * TOUCHED, which is what makes this meaningful: an item still on v3
 * was written against v3 and no remediation has needed to visit it
 * since. Counting them is the honest answer to "is my data current?".
 *
 * Counted by the database (functions.sql §13). This used to select
 * every item's version and count them here, which meant opening the
 * History tab on a large category pulled every row into memory to
 * produce one number.
 */
export async function getStaleItems(categoryId: string): Promise<StaleItems> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_stale_items", {
    p_category_id: categoryId,
  });

  if (error) throw new Error(`Could not read item versions: ${error.message}`);

  const row = (data ?? {}) as {
    current_version?: number;
    stale_count?: number;
    oldest_version?: number | null;
  };

  return {
    currentVersion: row.current_version ?? 0,
    staleCount: row.stale_count ?? 0,
    oldestVersion: row.oldest_version ?? null,
  };
}
