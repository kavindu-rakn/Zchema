"use client";

// ── Dev-only role switcher ───────────────────────────────────
// Was a floating button pinned to the bottom-right of every page.
// It is now a controlled dialog opened from the avatar menu in the
// top bar, so the shell owns its trigger and nothing floats.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/utils/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { Profile, UserRole } from "@/lib/types";

const ROLES: UserRole[] = ["SCHEMA_ADMIN", "DATA_EDITOR", "VIEWER"];

/**
 * Whether the role switcher is available to this account.
 * Development builds only, and only for the seeded admin — the top bar
 * uses this to decide whether to show the menu entry at all.
 */
export function canSwitchRole(email?: string | null): boolean {
  return process.env.NODE_ENV === "development" && email === "admin@schemashift.lk";
}

export function RoleSwitcher({
  user,
  profile,
  open,
  onOpenChange,
}: {
  user: User;
  profile: Profile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string>(profile?.role ?? "VIEWER");
  const [error, setError] = useState<string | null>(null);

  // Keep the radio in sync when the profile changes underneath us.
  useEffect(() => {
    setSelectedRole(profile?.role ?? "VIEWER");
  }, [profile?.role]);

  if (!canSwitchRole(user?.email)) return null;

  const handleRoleChange = async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ role: selectedRole })
        .eq("id", user.id);

      if (updateError) {
        setError(updateError.message);
        return;
      }
      onOpenChange(false);
      router.refresh();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-background sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">Switch role</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Development only. Changes your own role so you can check how each access level
            sees the app.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <RadioGroup value={selectedRole} onValueChange={setSelectedRole} className="space-y-3">
            {ROLES.map((role) => (
              <div
                key={role}
                className="flex items-center space-x-3 rounded-md border border-border/50 bg-secondary/20 p-3 transition-colors hover:border-primary/50"
              >
                <RadioGroupItem value={role} id={role} className="border-primary text-primary" />
                <Label htmlFor={role} className="w-full cursor-pointer font-mono text-sm text-foreground">
                  {role}
                </Label>
              </div>
            ))}
          </RadioGroup>

          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleRoleChange}
            disabled={isLoading}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isLoading ? "Updating…" : "Save role"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
