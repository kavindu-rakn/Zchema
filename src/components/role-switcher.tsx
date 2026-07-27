"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Bug } from "lucide-react";

const ROLES = ["TEMPLATE_ADMIN", "DATA_CONTRIBUTOR", "VIEWER"];

export function RoleSwitcher({ user, profile }: { user: any; profile: any }) {
  const router = useRouter();
  const supabase = createClient();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string>(profile?.role || "VIEWER");

  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  if (user?.email !== "admin@schemashift.lk") {
    return null;
  }

  const handleRoleChange = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ role: selectedRole })
        .eq("id", user.id);

      if (!error) {
        setIsOpen(false);
        router.refresh();
      } else {
        console.error("Failed to update role:", error);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger className="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border shadow-sm rounded-full h-12 w-12 bg-background border-primary/30 text-primary hover:bg-primary/10 hover:text-primary transition-all duration-300 hover:scale-110">
          <Bug className="h-5 w-5" />
        </DialogTrigger>
        <DialogContent className="sm:max-w-md bg-background border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Debug: Switch Role</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Change your current role to test different access levels across the dashboard.
            </DialogDescription>
          </DialogHeader>
          <div className="py-6">
            <RadioGroup value={selectedRole} onValueChange={setSelectedRole} className="space-y-4">
              {ROLES.map((role) => (
                <div key={role} className="flex items-center space-x-3 bg-secondary/20 p-3 rounded-md border border-border/50 transition-colors hover:border-primary/50">
                  <RadioGroupItem value={role} id={role} className="text-primary border-primary" />
                  <Label htmlFor={role} className="font-mono text-sm cursor-pointer w-full text-foreground">
                    {role}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button onClick={handleRoleChange} disabled={isLoading} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {isLoading ? "Updating..." : "Save Role"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
