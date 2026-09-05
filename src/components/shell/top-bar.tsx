"use client";

// ── Application shell: top bar ───────────────────────────────
// Replaces the old left sidebar. The sidebar's links were not peers
// (a destination, a preference, and three views of one workspace), so
// navigation now lives here and the category tree becomes the real
// navigation inside the Data Center.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { LogOut, Settings, UserCog } from "lucide-react";

import { createClient } from "@/utils/supabase/client";
import { CommandPalette } from "@/components/command-palette";
import { RoleSwitcher, canSwitchRole } from "@/components/role-switcher";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Profile } from "@/lib/types";

const ROLE_LABELS: Record<string, string> = {
  SCHEMA_ADMIN: "Schema Admin",
  DATA_EDITOR: "Data Editor",
  VIEWER: "Viewer",
};

function initialsFor(email?: string | null): string {
  if (!email) return "?";
  const [name] = email.split("@");
  const parts = name.split(/[.\-_]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function TopBar({
  user,
  profile,
}: {
  user: User;
  profile: Profile | null;
}) {
  const router = useRouter();
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);

  const role = profile?.role ?? "VIEWER";
  const showRoleSwitch = canSwitchRole(user?.email);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-4 border-b border-border bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        {/* Wordmark → home */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-md px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="text-primary" aria-hidden>
            ◈
          </span>
          <span className="font-heading text-sm font-semibold tracking-tight text-foreground">
            Zchema
          </span>
          <span className="hidden rounded border border-border px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:inline">
            Dynamic Catelog Engine
          </span>
        </Link>

        {/* Search / command palette — the existing palette owns ⌘K */}
        <div className="ml-2 flex flex-1 justify-center">
          <CommandPalette />
        </div>

        {/* Role + account */}
        <div className="flex items-center gap-3">
          <Badge
            variant="secondary"
            className="hidden bg-secondary/50 text-[10px] uppercase tracking-wider text-secondary-foreground sm:flex"
          >
            {ROLE_LABELS[role] ?? role}
          </Badge>

          <DropdownMenu>
            <DropdownMenuTrigger className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-secondary/40 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {initialsFor(user?.email)}
              <span className="sr-only">Open account menu</span>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">Account</p>
                    <p className="truncate text-xs leading-none text-muted-foreground">
                      {user?.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />

              {/* Base UI composes via `render`, not Radix's `asChild` — this
                  keeps a real anchor so middle-click / open-in-new-tab work. */}
              <DropdownMenuItem className="cursor-pointer" render={<Link href="/settings" />}>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>

              {showRoleSwitch && (
                <DropdownMenuItem
                  className="cursor-pointer"
                  // Defer opening until the menu has closed, so the dialog
                  // does not fight the dropdown for focus.
                  onSelect={(event) => {
                    event.preventDefault();
                    setTimeout(() => setRoleDialogOpen(true), 0);
                  }}
                >
                  <UserCog className="mr-2 h-4 w-4" />
                  Switch role
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleSignOut}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Rendered outside the dropdown so closing the menu cannot unmount it. */}
      <RoleSwitcher
        user={user}
        profile={profile}
        open={roleDialogOpen}
        onOpenChange={setRoleDialogOpen}
      />
    </>
  );
}
