import { notFound } from "next/navigation";

import { AttributeEditor } from "@/components/attributes/attribute-editor";
import { getAttribute, getAttributeUsage } from "@/lib/data/attributes";
import { getCurrentRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ attributeId: string }>;
}

export default async function AttributeDetailPage({ params }: PageProps) {
  const { attributeId } = await params;

  // A malformed id would make the usage query throw too; fail fast.
  const attribute = await getAttribute(attributeId).catch(() => null);
  if (!attribute) notFound();

  const [usage, role] = await Promise.all([
    getAttributeUsage(attributeId),
    getCurrentRole(),
  ]);

  return (
    <div className="space-y-6 p-6">
      <header className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground">
            {attribute.label}
          </h1>
          <code className="text-sm text-muted-foreground">{attribute.key}</code>
          <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground">
            {attribute.type}
          </span>
          {attribute.is_system && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
              system
            </span>
          )}
        </div>
        {attribute.description && (
          <p className="max-w-2xl text-sm text-muted-foreground">{attribute.description}</p>
        )}
      </header>

      <AttributeEditor
        attribute={attribute}
        usage={usage}
        canEdit={role === "SCHEMA_ADMIN"}
      />
    </div>
  );
}
