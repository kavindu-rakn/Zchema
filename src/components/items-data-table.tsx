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
import { Pencil, Trash2, MoreHorizontal, Search, ArrowUpDown, ChevronUp, ChevronDown, Filter, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

type ColumnFilter = {
  string?: string;
  number?: { min?: number; max?: number };
  boolean?: "all" | "yes" | "no";
  select?: string[];
  date?: { from?: string; to?: string };
};

export function ItemsDataTable({ template, items, categoryId, userRole }: ItemsDataTableProps) {
  const router = useRouter();
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>({});

  const handleFilterChange = (key: string, value: any, type: string) => {
    setFilters(prev => {
      const newFilters = { ...prev };
      let isEmpty = value === null || value === undefined;
      
      if (!isEmpty && typeof value === 'object') {
        if (Array.isArray(value)) {
          isEmpty = value.length === 0;
        } else {
          isEmpty = Object.values(value).every(v => v === undefined || v === '');
        }
      }

      if (isEmpty) {
        delete newFilters[key];
      } else {
        newFilters[key] = { [type]: value };
      }
      return newFilters;
    });
  };

  const clearFilters = () => setFilters({});

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

  const renderFilterPopover = (field: any) => {
    const currentFilter = filters[field.key] || {};
    return (
      <Popover>
        <PopoverTrigger
          className={`inline-flex items-center justify-center h-6 w-6 ml-1 rounded-md transition-colors ${currentFilter[field.type as keyof ColumnFilter] ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Filter className="h-3 w-3" />
        </PopoverTrigger>
        <PopoverContent 
          className="w-64 p-4 bg-zinc-950 border-zinc-800" 
          align="start"
        >
          <div className="space-y-4">
            <h4 className="font-medium text-sm text-zinc-200">Filter {field.label}</h4>
            
            {field.type === 'string' && (
              <Input 
                placeholder="Contains..."
                value={currentFilter.string || ''}
                onChange={e => handleFilterChange(field.key, e.target.value || null, 'string')}
                className="bg-zinc-900 border-zinc-800 text-zinc-100"
              />
            )}

            {field.type === 'number' && (
              <div className="flex items-center gap-2">
                <Input 
                  type="number"
                  placeholder="Min"
                  value={currentFilter.number?.min ?? ''}
                  onChange={e => {
                    const val = e.target.value;
                    const newMin = val === '' ? undefined : Number(val);
                    handleFilterChange(field.key, { ...currentFilter.number, min: newMin }, 'number');
                  }}
                  className="bg-zinc-900 border-zinc-800 text-zinc-100"
                />
                <span className="text-zinc-500">-</span>
                <Input 
                  type="number"
                  placeholder="Max"
                  value={currentFilter.number?.max ?? ''}
                  onChange={e => {
                    const val = e.target.value;
                    const newMax = val === '' ? undefined : Number(val);
                    handleFilterChange(field.key, { ...currentFilter.number, max: newMax }, 'number');
                  }}
                  className="bg-zinc-900 border-zinc-800 text-zinc-100"
                />
              </div>
            )}

            {field.type === 'boolean' && (
               <Select 
                 value={currentFilter.boolean || "all"} 
                 onValueChange={v => handleFilterChange(field.key, v === "all" ? null : v, 'boolean')}
               >
                 <SelectTrigger className="w-full bg-zinc-900 border-zinc-800 text-zinc-100">
                   <SelectValue placeholder="All" />
                 </SelectTrigger>
                 <SelectContent className="bg-zinc-950 border-zinc-800 text-zinc-100">
                   <SelectItem value="all">All</SelectItem>
                   <SelectItem value="yes">Yes</SelectItem>
                   <SelectItem value="no">No</SelectItem>
                 </SelectContent>
               </Select>
            )}

            {field.type === 'select' && field.options && (
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {field.options.map((opt: string) => {
                  const isSelected = currentFilter.select?.includes(opt);
                  return (
                    <label key={opt} className="flex items-center gap-2 text-sm text-zinc-300">
                      <input 
                        type="checkbox" 
                        checked={isSelected || false}
                        onChange={(e) => {
                          let newSelect = [...(currentFilter.select || [])];
                          if (e.target.checked) {
                            newSelect.push(opt);
                          } else {
                            newSelect = newSelect.filter(o => o !== opt);
                          }
                          handleFilterChange(field.key, newSelect.length > 0 ? newSelect : null, 'select');
                        }}
                        className="rounded border-zinc-700 bg-zinc-900 accent-emerald-500"
                      />
                      {opt}
                    </label>
                  )
                })}
              </div>
            )}

            {field.type === 'date' && (
              <div className="flex flex-col gap-2">
                <Input 
                  type="date"
                  value={currentFilter.date?.from || ''}
                  onChange={e => {
                    const val = e.target.value;
                    handleFilterChange(field.key, { ...currentFilter.date, from: val || undefined }, 'date');
                  }}
                  className="bg-zinc-900 border-zinc-800 text-zinc-100 [color-scheme:dark]"
                />
                <Input 
                  type="date"
                  value={currentFilter.date?.to || ''}
                  onChange={e => {
                    const val = e.target.value;
                    handleFilterChange(field.key, { ...currentFilter.date, to: val || undefined }, 'date');
                  }}
                  className="bg-zinc-900 border-zinc-800 text-zinc-100 [color-scheme:dark]"
                />
              </div>
            )}
            
            <div className="flex justify-end pt-2">
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-zinc-400 hover:text-zinc-100 h-8"
                onClick={() => handleFilterChange(field.key, null, field.type)}
              >
                Clear
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  // Client-side search and filter
  const filtered = useMemo(() => {
    let result = items;
    
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(item =>
        template.fields.some(f => {
          const val = item.data[f.key];
          return val !== undefined && val !== null && String(val).toLowerCase().includes(q);
        })
      );
    }

    if (Object.keys(filters).length > 0) {
      result = result.filter(item => {
        return Object.entries(filters).every(([key, filter]) => {
          const val = item.data[key];
          const field = template.fields.find(f => f.key === key);
          if (!field) return true;

          if (filter.string) {
            if (val === undefined || val === null) return false;
            return String(val).toLowerCase().includes(filter.string.toLowerCase());
          }
          if (filter.number) {
            if (val === undefined || val === null) return false;
            const num = Number(val);
            if (isNaN(num)) return false;
            if (filter.number.min !== undefined && num < filter.number.min) return false;
            if (filter.number.max !== undefined && num > filter.number.max) return false;
            return true;
          }
          if (filter.boolean && filter.boolean !== "all") {
            const isTrue = filter.boolean === "yes";
            return Boolean(val) === isTrue;
          }
          if (filter.select && filter.select.length > 0) {
            if (val === undefined || val === null) return false;
            return filter.select.includes(String(val));
          }
          if (filter.date) {
            if (!val) return false;
            const d = new Date(val as string | number);
            if (isNaN(d.getTime())) return false;
            if (filter.date.from && d < new Date(filter.date.from)) return false;
            if (filter.date.to && d > new Date(filter.date.to)) return false;
            return true;
          }
          return true;
        });
      });
    }

    return result;
  }, [items, search, template.fields, filters]);

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

      {Object.keys(filters).length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(filters).map(([key, filter]) => {
            const field = template.fields.find(f => f.key === key);
            if (!field) return null;
            
            let displayValue = '';
            if (filter.string) displayValue = `Contains: "${filter.string}"`;
            else if (filter.number) {
              const min = filter.number.min;
              const max = filter.number.max;
              if (min !== undefined && max !== undefined) displayValue = `${min} - ${max}`;
              else if (min !== undefined) displayValue = `>= ${min}`;
              else if (max !== undefined) displayValue = `<= ${max}`;
            }
            else if (filter.boolean) displayValue = filter.boolean === 'yes' ? 'Yes' : 'No';
            else if (filter.select) displayValue = filter.select.join(', ');
            else if (filter.date) {
              const from = filter.date.from;
              const to = filter.date.to;
              if (from && to) displayValue = `${from} to ${to}`;
              else if (from) displayValue = `After ${from}`;
              else if (to) displayValue = `Before ${to}`;
            }

            return (
              <Badge key={key} variant="secondary" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 flex items-center gap-1 py-1 px-2 font-normal">
                <span className="font-medium text-zinc-300">{field.label}:</span> {displayValue}
                <button 
                  onClick={() => handleFilterChange(key, null, field.type)}
                  className="ml-1 hover:text-emerald-300 focus:outline-none"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={clearFilters}
            className="h-6 px-2 text-xs text-zinc-400 hover:text-zinc-100"
          >
            Clear all filters
          </Button>
        </div>
      )}

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
                      {renderFilterPopover(field)}
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
