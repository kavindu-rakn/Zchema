"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, LayoutDashboard, Layers, FolderTree, Database, PlusCircle } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const runCommand = (command: () => void) => {
    setOpen(false);
    command();
  };

  return (
    <>
      <Button
        variant="outline"
        className="relative h-8 w-full justify-start rounded-[0.5rem] bg-background text-sm font-normal text-muted-foreground shadow-none sm:pr-12 md:w-40 lg:w-64 border-border/50 hover:bg-accent/50"
        onClick={() => setOpen(true)}
      >
        <Search className="mr-2 h-4 w-4" />
        <span className="hidden lg:inline-flex">Search or command...</span>
        <span className="inline-flex lg:hidden">Search...</span>
        <kbd className="pointer-events-none absolute right-[0.3rem] top-[0.3rem] hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Navigation">
            <CommandItem onSelect={() => runCommand(() => router.push("/dashboard"))}>
              <LayoutDashboard className="mr-2 h-4 w-4" />
              Dashboard
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => router.push("/blueprints"))}>
              <Layers className="mr-2 h-4 w-4" />
              Blueprints
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => router.push("/categories"))}>
              <FolderTree className="mr-2 h-4 w-4" />
              Categories
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => router.push("/catalog"))}>
              <Database className="mr-2 h-4 w-4" />
              Catalog
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Actions">
            <CommandItem onSelect={() => runCommand(() => router.push("/blueprints/new"))}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Create Blueprint
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => router.push("/categories/new"))}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Create Category
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
