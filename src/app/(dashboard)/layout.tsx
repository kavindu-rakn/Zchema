import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { TopBar } from "@/components/shell/top-bar";
import type { Profile } from "@/lib/types";

// ── Dashboard shell ──────────────────────────────────────────
// Top bar + content. No left sidebar: inside the Data Center the
// category tree is the navigation, and everywhere else the top bar
// is enough.
//
// Scrolling: this layout deliberately sets NO `overflow-hidden` and no
// scroll container of its own. Ordinary pages scroll with the document;
// the Data Center pins itself to the viewport and gives the tree rail
// and the detail pane their own scroll containers. Adding an outer
// overflow here reintroduces the double-scrollbar this replaced.

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
      <TopBar user={user} profile={(profile as Profile) ?? null} />
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
