import { getAttributesWithUsage, getDuplicateFieldDefinitions } from "@/lib/data/attributes";
import { getCurrentRole } from "@/lib/auth";
import { AttributeRail } from "@/components/attributes/attribute-rail";

export const dynamic = "force-dynamic";

// Same master–detail shape as blueprints and the category workspace.

export default async function AttributesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [attributes, duplicates, role] = await Promise.all([
    getAttributesWithUsage(),
    getDuplicateFieldDefinitions(),
    getCurrentRole(),
  ]);

  // The Data Center pane is already the scroll container, so the rail
  // sticks rather than owning a second scrollport.
  return (
    <div className="flex min-h-full w-full">
      <AttributeRail
        attributes={attributes}
        duplicates={duplicates}
        canEdit={role === "SCHEMA_ADMIN"}
      />
      <section className="min-w-0 flex-1">{children}</section>
    </div>
  );
}
