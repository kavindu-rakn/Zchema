"use client";

import { useState } from "react";
import { Item, Template } from "@/lib/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DynamicForm } from "./dynamic-form";
import { updateItem, deleteItem } from "@/app/(dashboard)/catalog/actions";
import { useRouter } from "next/navigation";

interface ItemsDataTableProps {
  template: Template;
  items: Item[];
  categoryId: string;
}

export function ItemsDataTable({ template, items, categoryId }: ItemsDataTableProps) {
  const router = useRouter();
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const handleUpdate = async (data: Record<string, any>) => {
    if (!editingItem) return;
    await updateItem(editingItem.id, categoryId, data);
    setEditingItem(null);
    router.refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this item?")) return;
    setIsDeleting(id);
    try {
      await deleteItem(id, categoryId);
      router.refresh();
    } finally {
      setIsDeleting(null);
    }
  };

  const renderCellValue = (value: any, type: string) => {
    if (value === undefined || value === null) return <span className="text-zinc-500">-</span>;
    if (type === "boolean") {
      return value ? (
        <span className="inline-flex items-center rounded-full bg-emerald-400/10 px-2 py-1 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-400/20">
          Yes
        </span>
      ) : (
        <span className="inline-flex items-center rounded-full bg-zinc-400/10 px-2 py-1 text-xs font-medium text-zinc-400 ring-1 ring-inset ring-zinc-400/20">
          No
        </span>
      );
    }
    return String(value);
  };

  if (!items.length) {
    return (
      <div className="flex h-48 flex-col items-center justify-center rounded-md border border-dashed border-zinc-800 bg-zinc-950/50">
        <p className="text-sm text-zinc-400">No items found.</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/50">
      <Table>
        <TableHeader>
          <TableRow className="border-zinc-800 hover:bg-transparent">
            {template.fields.map((field) => (
              <TableHead key={field.key} className="text-zinc-400">
                {field.label}
              </TableHead>
            ))}
            <TableHead className="w-[80px] text-zinc-400 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id} className="border-zinc-800 hover:bg-zinc-900/50">
              {template.fields.map((field) => (
                <TableCell key={field.key} className="text-zinc-300">
                  {renderCellValue(item.data[field.key], field.type)}
                </TableCell>
              ))}
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 w-8 p-0 hover:bg-zinc-800 hover:text-zinc-50 transition-colors">
                    <MoreHorizontal className="h-4 w-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[160px] bg-zinc-950 border-zinc-800">
                    <DropdownMenuItem
                      onClick={() => setEditingItem(item)}
                      className="text-zinc-300 hover:text-white hover:bg-zinc-800 cursor-pointer focus:bg-zinc-800"
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit Item
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleDelete(item.id)}
                      disabled={isDeleting === item.id}
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10 cursor-pointer focus:bg-red-500/10 focus:text-red-300"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {isDeleting === item.id ? "Deleting..." : "Delete Item"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent className="sm:max-w-[425px] bg-zinc-950 border-zinc-800">
          <DialogHeader>
            <DialogTitle className="text-zinc-100">Edit Item</DialogTitle>
          </DialogHeader>
          {editingItem && (
            <DynamicForm
              template={template}
              initialData={{ id: editingItem.id, ...editingItem.data }}
              onSubmit={handleUpdate}
              onCancel={() => setEditingItem(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
