"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DynamicForm } from "./dynamic-form";
import { createItem } from "@/app/(dashboard)/catalog/actions";
import { Template, UserRole } from "@/lib/types";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface AddItemDialogProps {
  categoryId: string;
  template: Template;
  userRole: UserRole;
}

export function AddItemDialog({ categoryId, template, userRole }: AddItemDialogProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const handleSubmit = async (data: Record<string, any>) => {
    try {
      await createItem(categoryId, data);
      toast.success('Item added successfully');
      setOpen(false);
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add item');
    }
  };

  // VIEWERs cannot add items
  if (userRole === 'VIEWER') return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-9 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white transition-colors">
        <Plus className="mr-2 h-4 w-4" />
        Add Item
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] bg-zinc-950 border-zinc-800">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">Add New Item</DialogTitle>
        </DialogHeader>
        <DynamicForm
          template={template}
          onSubmit={handleSubmit}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
