// ── Server-side authentication & authorisation ───────────────
// RLS is the last line of defence, not the only one. Every mutating
// server action re-checks the caller's role here, because a Server
// Action is a public POST endpoint: rendering a button conditionally
// is a UI affordance, not a security boundary.

import { createClient } from "@/utils/supabase/server";
import type { Profile, UserRole } from "./types";

/** Thrown when the caller is not signed in. */
export class UnauthorizedError extends Error {
  constructor(message = "You must be signed in to do that.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** Thrown when the caller is signed in but lacks the required role. */
export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** The signed-in user's profile, or null when not signed in. */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, role, created_at")
    .eq("id", user.id)
    .single();

  if (error || !data) return null;
  return data as Profile;
}

/** The signed-in user's role, or null when not signed in. */
export async function getCurrentRole(): Promise<UserRole | null> {
  const profile = await getCurrentProfile();
  return profile?.role ?? null;
}

/** Require a signed-in user; throws otherwise. */
export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) throw new UnauthorizedError();
  return profile;
}

/**
 * Require one of `roles`. Throws UnauthorizedError when signed out and
 * ForbiddenError when signed in with an insufficient role. Messages are
 * written to surface directly in a toast.
 */
export async function requireRole(...roles: UserRole[]): Promise<Profile> {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) {
    throw new ForbiddenError(
      `This action requires the ${roles.join(" or ")} role — your role is ${profile.role}.`
    );
  }
  return profile;
}

/** Schema changes (categories, blueprints, attributes) are admin-only. */
export async function requireSchemaAdmin(): Promise<Profile> {
  return requireRole("SCHEMA_ADMIN");
}

/** Item data may be edited by admins and data editors. */
export async function requireDataEditor(): Promise<Profile> {
  return requireRole("SCHEMA_ADMIN", "DATA_EDITOR");
}
