import { redirect } from "next/navigation";
import { Calendar, Mail, Shield } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DensityToggle } from "@/components/settings/density-toggle";
import { UsersTable } from "@/components/settings/users-table";
import { SignOutEverywhere } from "@/components/settings/sign-out-everywhere";
import { getCurrentProfile } from "@/lib/auth";
import { getProfiles } from "@/lib/data/profiles";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, { label: string; description: string }> = {
  SCHEMA_ADMIN: {
    label: "Schema Admin",
    description: "Can change the data model — categories, fields and blueprints.",
  },
  DATA_EDITOR: {
    label: "Data Editor",
    description: "Can add and edit items, but not change the schema.",
  },
  VIEWER: { label: "Viewer", description: "Read-only access." },
};

export default async function SettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const isAdmin = profile.role === "SCHEMA_ADMIN";
  const role = ROLE_LABELS[profile.role] ?? { label: profile.role, description: "" };

  // RLS returns only your own row to a non-admin, so this stays cheap.
  const profiles = isAdmin ? await getProfiles() : [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Your account, how the app looks, and — for admins — who can do what.
        </p>
      </header>

      {/* ── Profile ─────────────────────────────────────────── */}
      <Card className="border-border/50 bg-card">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Profile</CardTitle>
          <CardDescription className="text-muted-foreground">
            Your role determines what you can change. Only an admin can reassign roles.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Mail className="h-3.5 w-3.5" />
                Email
              </dt>
              <dd className="truncate text-sm text-foreground">{profile.email}</dd>
            </div>

            <div className="space-y-1">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Shield className="h-3.5 w-3.5" />
                Role
              </dt>
              <dd className="text-sm text-foreground">
                <span className="inline-flex items-center rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {role.label}
                </span>
                <p className="mt-1 text-xs text-muted-foreground">{role.description}</p>
              </dd>
            </div>

            <div className="space-y-1">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                Member since
              </dt>
              <dd className="text-sm text-foreground">
                {new Date(profile.created_at).toLocaleDateString()}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* ── Appearance ──────────────────────────────────────── */}
      <Card className="border-border/50 bg-card">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Appearance</CardTitle>
          <CardDescription className="text-muted-foreground">
            SchemaShift is a data tool — compact fits more of your catalogue on screen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DensityToggle />
        </CardContent>
      </Card>

      {/* ── Users (admin only) ──────────────────────────────── */}
      {isAdmin && (
        <Card className="border-border/50 bg-card">
          <CardHeader>
            <CardTitle className="text-base text-foreground">Users</CardTitle>
            <CardDescription className="text-muted-foreground">
              Everyone who has signed in. New accounts start as Viewer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UsersTable profiles={profiles} currentUserId={profile.id} />
          </CardContent>
        </Card>
      )}

      {/* ── Danger zone ─────────────────────────────────────── */}
      <Card className="border-destructive/30 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
          <CardDescription className="text-muted-foreground">
            Useful if you have signed in somewhere you no longer control.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutEverywhere />
        </CardContent>
      </Card>
    </div>
  );
}
