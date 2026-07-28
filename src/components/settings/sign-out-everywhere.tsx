"use client";

// ── Danger zone: sign out of every session ───────────────────

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function SignOutEverywhere() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const confirm = () => {
    startTransition(async () => {
      const supabase = createClient();
      // `global` revokes every refresh token for this user, not just
      // the session in this browser.
      const { error } = await supabase.auth.signOut({ scope: "global" });
      if (error) {
        toast.error(error.message);
        return;
      }
      router.push("/login");
      router.refresh();
    });
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <LogOut className="mr-2 h-4 w-4" />
        Sign out everywhere
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sign out of all sessions?</DialogTitle>
            <DialogDescription>
              This ends your session on every device and browser, including this one. You will
              need to sign in again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              onClick={confirm}
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {pending ? "Signing out…" : "Sign out everywhere"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
