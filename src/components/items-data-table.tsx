"use client";

import { useState, useMemo } from "react";
import { Item, Template, UserRole } from "@/lib/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, MoreHorizontal, Search, ArrowUpDown, ChevronUp, ChevronDown } from "lucide-react";
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
import { toast } from "sonner";

interface ItemsDataTableProps {
  template: Template;
  items: Item[];
  categoryId: string;
  userRole: UserRole;
}

type SortConfig = { key: string; dir: "asc" | "desc" } | null;

export function ItemsDataTable({ template, items, categoryId, userRole }: ItemsDataTableProps) {
  const router = useRouter();
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);

  const handleUpdate = async (data: Record<string, any>) => {
    if (!editingItem) return;
    try {
      await updateItem(editingItem.id, categoryId, data);
      toast.success("Item updated");
      setEditingItem(null);
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update item");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this item?")) return;
    setIsDeleting(id);
    try {
      await deleteItem(id, categoryId);
      toast.success("Item deleted");
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete item");
    } finally {
      setIsDeleting(null);
    }
  };

  const handleSort = (key: string) => {
    setSortConfig(prev =>
      prev?.key === key
        ? prev.dir === "asc"
          ? { key, dir: "desc" }
          : null
        : { key, dir: "asc" }
    );
  };

  const SortIcon = ({ fieldKey }: { fieldKey: string }) => {
    if (sortConfig?.key !== fieldKey) return <ArrowUpDown className="h-3 w-3 ml-1 text-zinc-600" />;
    return sortConfig.dir === "asc"
      ? <ChevronUp className="h-3 w-3 ml-1 text-emerald-400" />
      : <ChevronDown className="h-3 w-3 ml-1 text-emerald-400" />;
  };

  const renderCellValue = (value: any, type: string) => {
    if (value === undefined || value === null) return <span className="text-zinc-500">—</span>;
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

  // Client-side search filter
  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(item =>
      template.fields.some(f => {
        const val = item.data[f.key];
        return val !== undefined && val !== null && String(val).toLowerCase().includes(q);
      })
    );
  }, [items, search, template.fields]);

  // Client-side sort
  const sorted = useMemo(() => {
    if (!sortConfig) return filtered;
    return [...filtered].sort((a, b) => {
      const aVal = a.data[sortConfig.key] ?? "";
      const bVal = b.data[sortConfig.key] ?? "";
      const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
      return sortConfig.dir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortConfig]);

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <Input
            placeholder="Search items..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-zinc-900 border-zinc-800 focus-visible:ring-emerald-500 text-zinc-100 placeholder:text-zinc-600"
          />
        </div>
        <Badge variant="secondary" className="bg-zinc-900 text-zinc-400 border border-zinc-800 shrink-0">
          {sorted.length} {sorted.length === 1 ? "item" : "items"}
        </Badge>
      </div>

      {sorted.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-md border border-dashed border-zinc-800 bg-zinc-950/50">
          <p className="text-sm text-zinc-400">
            {search ? "No items match your search." : "No items found."}
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-zinc-800 bg-zinc-950/50">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                {template.fields.map((field) => (
                  <TableHead
                    key={field.key}
                    className="text-zinc-400 cursor-pointer select-none hover:text-zinc-200 transition-colors"
                    onClick={() => handleSort(field.key)}
                  >
                    <span className="inline-flex items-center">
                      {field.label}
                      <SortIcon fieldKey={field.key} />
                    </span>
                  </TableHead>
                ))}
                {userRole !== "VIEWER" && (
                  <TableHead className="w-[80px] text-zinc-400 text-right">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((item) => (
                <TableRow key={item.id} className="border-zinc-800 hover:bg-zinc-900/50">
                  {template.fields.map((field) => (
                    <TableCell key={field.key} className="text-zinc-300">
                      {renderCellValue(item.data[field.key], field.type)}
                    </TableCell>
                  ))}
                  {userRole !== "VIEWER" && (
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
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

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
