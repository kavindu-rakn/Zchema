import { Tags } from "lucide-react";

import { getAttributesWithUsage, getDuplicateFieldDefinitions } from "@/lib/data/attributes";

export const dynamic = "force-dynamic";

// The framing matters more than the list. The single most likely
// misunderstanding is thinking an attribute is another blueprint — a
// preset you copy from. It is the opposite: a live link, and the link
// is what makes "everything by Sony, anywhere" answerable.

export default async function AttributesPage() {
  const [attributes, duplicates] = await Promise.all([
    getAttributesWithUsage(),
    getDuplicateFieldDefinitions(),
  ]);

  const linked = attributes.filter((attribute) => attribute.category_count > 0).length;

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-6 py-12">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-primary">
          <Tags className="h-5 w-5" />
          <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground">
            Attributes
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Shared field definitions. Unlike a blueprint, an attribute stays linked: editing its
          label or options updates every category using it, and the link is what lets one search
          span the whole catalog.
        </p>
      </div>

      <div className="mt-6 space-y-3 rounded-md border border-border bg-card/40 p-4">
        {attributes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing in the library yet. The quickest way to start is the{" "}
            <strong className="text-foreground">Repeated fields</strong> panel — it finds the
            fields you have already written more than once and turns one of them into the
            canonical definition.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">{attributes.length}</strong> attribute
            {attributes.length === 1 ? "" : "s"}, {linked} in use. Pick one to edit it or see
            where it is used.
          </p>
        )}

        {duplicates.length > 0 && (
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">{duplicates.length}</strong> field
            {duplicates.length === 1 ? " is" : "s are"} defined on more than one category with
            nothing linking them — {duplicates.slice(0, 3).map((d) => d.key).join(", ")}
            {duplicates.length > 3 && ", …"}. Promoting them is how the library fills up.
          </p>
        )}
      </div>
    </div>
  );
}
