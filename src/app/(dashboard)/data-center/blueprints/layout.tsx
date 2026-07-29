import { getBlueprintsWithUsage } from "@/lib/data/blueprints";
import { getCurrentRole } from "@/lib/auth";
import { BlueprintRail } from "@/components/blueprints/blueprint-rail";

export const dynamic = "force-dynamic";

// Same master–detail shape as the category workspace: a list on the
// left, the selected blueprint on the right.

export default async function BlueprintsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [blueprints, role] = await Promise.all([
    getBlueprintsWithUsage(),
    getCurrentRole(),
  ]);

  // The Data Center pane is already the scroll container, so the rail
  // sticks rather than owning a second scrollport — nesting one inside
  // the other is what produces a double scrollbar.
  return (
    <div className="flex min-h-full w-full">
      <BlueprintRail blueprints={blueprints} canEdit={role === "SCHEMA_ADMIN"} />
      <section className="min-w-0 flex-1">{children}</section>
    </div>
  );
}
