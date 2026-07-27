"use client";

import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { CommandPalette } from "./command-palette";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { UserCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function Header({ user, profile }: { user: any; profile: any }) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();

  // Basic title extraction from path
  const pageTitle = pathname.split('/')[1] 
    ? pathname.split('/')[1].charAt(0).toUpperCase() + pathname.split('/')[1].slice(1)
    : "Dashboard";

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <header className="h-14 border-b border-border bg-background flex items-center justify-between px-6 shrink-0 z-10">
      <div className="flex items-center">
        <h1 className="text-sm font-medium text-foreground">{pageTitle}</h1>
      </div>

      <div className="flex items-center gap-4">
        <CommandPalette />

        <Badge variant="secondary" className="hidden sm:flex uppercase text-[10px] bg-secondary/50 text-secondary-foreground">
          {profile?.role || 'VIEWER'}
        </Badge>

        <DropdownMenu>
          <DropdownMenuTrigger className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-accent/50 focus:outline-none">
            <UserCircle className="h-5 w-5" />
            <span className="sr-only">Toggle user menu</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">Account</p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {user?.email}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive cursor-pointer">
                Sign out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
