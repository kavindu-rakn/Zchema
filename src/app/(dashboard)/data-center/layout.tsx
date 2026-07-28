import { getCategoryTreeFlat } from "@/lib/data/categories";
import { buildCategoryTree } from "@/lib/schema";
import { Rail } from "@/components/data-center/rail";
import { MobileTreeDrawer } from "@/components/data-center/mobile-tree-drawer";

export const dynamic = "force-dynamic";

// ── Data Center shell ────────────────────────────────────────
// The tree is fetched ONCE here, in the layout, so moving between
// categories re-renders only the detail pane.
//
// Scrolling: the app shell deliberately owns no scroll container, so
// this workspace pins itself to the viewport (minus the 56px top bar)
// and gives the rail and the detail pane one each. That is what keeps
// a long tree from scrolling the whole document.

export default async function DataCenterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tree = buildCategoryTree(await getCategoryTreeFlat());

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden">
      <Rail tree={tree} />
      <section className="min-w-0 flex-1 overflow-y-auto">
        <MobileTreeDrawer tree={tree} />
        {children}
      </section>
    </div>
  );
}
