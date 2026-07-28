"use client";

// ── Admin: user role management ──────────────────────────────

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { updateUserRole } from "@/app/(dashboard)/settings/actions";
import type { Profile, UserRole } from "@/lib/types";

const ROLES: { value: UserRole; label: string; hint: string }[] = [
  { value: "SCHEMA_ADMIN", label: "Schema Admin", hint: "Can change the data model" },
  { value: "DATA_EDITOR", label: "Data Editor", hint: "Can edit items, not schema" },
  { value: "VIEWER", label: "Viewer", hint: "Read only" },
];

export function UsersTable({
  profiles,
  currentUserId,
}: {
  profiles: Profile[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const changeRole = (userId: string, role: UserRole) => {
    setBusyId(userId);
    startTransition(async () => {
      const result = await updateUserRole(userId, role);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Role updated");
        router.refresh();
      }
      setBusyId(null);
    });
  };

  if (profiles.length === 0) {
    return <p className="text-sm text-muted-foreground">No users yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th data-slot="table-head" className="px-2 py-2 font-medium text-muted-foreground">
              User
            </th>
            <th data-slot="table-head" className="px-2 py-2 font-medium text-muted-foreground">
              Role
            </th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((profile) => {
            const isSelf = profile.id === currentUserId;
            return (
              <tr key={profile.id} className="border-b border-border/50 last:border-0">
                <td data-slot="table-cell" className="px-2 py-3">
                  <span className="block truncate text-foreground">{profile.email}</span>
                  {isSelf && <span className="text-xs text-muted-foreground">You</span>}
                </td>
                <td data-slot="table-cell" className="px-2 py-3">
                  <select
                    value={profile.role}
                    disabled={pending && busyId === profile.id}
                    aria-label={`Role for ${profile.email}`}
                    onChange={(event) =>
                      changeRole(profile.id, event.target.value as UserRole)
                    }
                    className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    {ROLES.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <dl className="mt-4 space-y-1">
        {ROLES.map((role) => (
          <div key={role.value} className="flex gap-2 text-xs">
            <dt className="w-28 shrink-0 font-medium text-muted-foreground">{role.label}</dt>
            <dd className="text-muted-foreground">{role.hint}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
