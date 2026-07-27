"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { LayoutDashboard, Layers, FolderTree, Database, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const navItems = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Templates", href: "/templates", icon: Layers },
  { name: "Categories", href: "/categories", icon: FolderTree },
  { name: "Catalog", href: "/catalog", icon: Database },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar({ user, profile }: { user: any; profile: any }) {
  const pathname = usePathname();

  return (
    <aside className="w-60 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col h-screen transition-all duration-300">
      <div className="h-14 flex items-center gap-3 px-6 border-b border-sidebar-border">
        <Image src="/logo-icon.png" alt="SchemaShift Logo" width={40} height={40} className="object-contain" />
        <span className="font-bold text-lg tracking-tight text-sidebar-foreground">SchemaShift</span>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-primary/10 text-primary border-l-2 border-primary"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground border-l-2 border-transparent"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border bg-sidebar/50">
        <div className="flex flex-col space-y-1">
          <span className="text-sm font-medium truncate text-sidebar-foreground">{user?.email || "user@example.com"}</span>
          <div className="flex items-center mt-1">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider border-primary/20 text-primary">
              {profile?.role || "VIEWER"}
            </Badge>
          </div>
        </div>
      </div>
    </aside>
  );
}
