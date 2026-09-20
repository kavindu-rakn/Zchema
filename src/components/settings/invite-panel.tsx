"use client";

// ── Admin: invitations ───────────────────────────────────────
// Zchema sends no email of its own, so an invitation is a link the
// admin copies and passes on. The token is shown once, here, right
// after it is made: only its hash is stored, so it cannot be looked up
// again — a lost link is replaced, not recovered.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createInvitation, revokeInvitation } from "@/app/(dashboard)/settings/actions";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Invitation, UserRole } from "@/lib/types";

const ROLES: { value: UserRole; label: string }[] = [
  { value: "VIEWER", label: "Viewer" },
  { value: "DATA_EDITOR", label: "Data Editor" },
  { value: "SCHEMA_ADMIN", label: "Schema Admin" },
];

const ROLE_LABEL: Record<UserRole, string> = {
  SCHEMA_ADMIN: "Schema Admin",
  DATA_EDITOR: "Data Editor",
  VIEWER: "Viewer",
};

const STATUS_CLASS: Record<Invitation["status"], string> = {
  open: "border-primary/30 bg-primary/10 text-primary",
  expired: "border-border bg-muted/40 text-muted-foreground",
  accepted: "border-border bg-muted/40 text-muted-foreground",
};

export function InvitePanel({ invitations }: { invitations: Invitation[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("DATA_EDITOR");
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const invite = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await createInvitation(email.trim(), role);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { token, email: invited } = result.data;
      setLink({
        url: `${window.location.origin}/signup?invite=${token}&email=${encodeURIComponent(invited)}`,
        email: invited,
      });
      setCopied(false);
      setEmail("");
      toast.success(`Invitation ready for ${invited}`);
      router.refresh();
    });
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      toast.success("Link copied");
    } catch {
      // Clipboard blocked — the link is on screen to copy by hand.
      toast.error("Could not copy — select the link and copy it.");
    }
  };

  const revoke = (invitation: Invitation) => {
    startTransition(async () => {
      const result = await revokeInvitation(invitation.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Invitation for ${invitation.email} revoked`);
      if (link?.email === invitation.email) setLink(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <form onSubmit={invite} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1 space-y-1.5">
          <Label htmlFor="invite-email" className="text-foreground">
            Email
          </Label>
          <Input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="teammate@example.com"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-role" className="text-foreground">
            Role
          </Label>
          <select
            id="invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {ROLES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <UserPlus className="mr-1.5 h-3.5 w-3.5" />
          )}
          Create invite link
        </Button>
      </form>

      {link && (
        <div className="space-y-1.5 rounded-md border border-primary/30 bg-primary/5 p-3">
          <p className="text-sm text-foreground">
            Send this to {link.email}. It is shown once — it is stored only as a hash.
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={link.url}
              onFocus={(event) => event.currentTarget.select()}
              aria-label="Invitation link"
              className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="button" variant="outline" onClick={copy}>
              {copied ? (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Copy className="mr-1.5 h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}

      {invitations.length > 0 && (
        <ul className="divide-y divide-border/50 border-t border-border/50">
          {invitations.map((invitation) => (
            <li key={invitation.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {invitation.email}
              </span>
              <span className="text-xs text-muted-foreground">
                {ROLE_LABEL[invitation.role]}
              </span>
              <span
                className={cn(
                  "rounded border px-1.5 py-0.5 text-xs",
                  STATUS_CLASS[invitation.status]
                )}
              >
                {invitation.status === "accepted"
                  ? `accepted ${timeAgo(invitation.accepted_at ?? invitation.created_at)}`
                  : invitation.status === "expired"
                    ? "expired"
                    : `expires ${timeAgo(invitation.expires_at)}`}
              </span>
              {invitation.status !== "accepted" && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => revoke(invitation)}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
