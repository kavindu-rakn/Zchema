import { createClient } from "@/utils/supabase/server";
import { Layers, FolderTree, Database, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

async function fetchDashboardStats() {
  const supabase = await createClient();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [blueprintsRes, categoriesRes, itemsRes, recentItemsRes] = await Promise.all([
    supabase.from("blueprints").select("id", { count: "exact", head: true }),
    supabase.from("categories").select("id", { count: "exact", head: true }),
    supabase.from("items").select("id", { count: "exact", head: true }),
    supabase
      .from("items")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo.toISOString()),
  ]);

  return {
    blueprints: blueprintsRes.count ?? 0,
    categories: categoriesRes.count ?? 0,
    items: itemsRes.count ?? 0,
    recentItems: recentItemsRes.count ?? 0,
  };
}

export default async function DashboardPage() {
  const stats = await fetchDashboardStats();

  const cards = [
    {
      title: "Blueprints",
      value: stats.blueprints,
      subtitle: "Starter presets",
      icon: Layers,
    },
    {
      title: "Categories",
      value: stats.categories,
      subtitle: "Active categorizations",
      icon: FolderTree,
    },
    {
      title: "Catalog Items",
      value: stats.items.toLocaleString(),
      subtitle: "Across all categories",
      icon: Database,
    },
    {
      title: "Recent Activity",
      value: `+${stats.recentItems}`,
      subtitle: "Items added this week",
      icon: Activity,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-foreground">Welcome to SchemaShift</h2>
        <p className="text-muted-foreground mt-1">
          Manage your dynamic schema templates and catalog data seamlessly.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((card, i) => (
          <Card
            key={i}
            className="bg-card border-border/50 shadow-sm hover:shadow-md hover:border-primary/20 transition-all duration-200"
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <card.icon className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{card.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{card.subtitle}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
