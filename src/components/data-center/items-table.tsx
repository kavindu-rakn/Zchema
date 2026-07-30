"use client";

// ── Items table ──────────────────────────────────────────────
// Columns come from the effective schema, so every header can say
// where its field came from. Sort, filter and pagination are all
// server-side (see query_items) — filtering the current page in the
// browser is fine at 20 rows and wrong at 2,000.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Info,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ColumnPicker } from "@/components/data-center/column-picker";
import { ColumnFilter } from "@/components/data-center/column-filter";
import { ItemSheet } from "@/components/data-center/item-sheet";
import { ImportEntry } from "@/components/import/import-entry";
import { ExportButton } from "@/components/search/export-button";
import { completenessOf, displayValueFor } from "@/lib/items";
import {
  decodeFilters,
  defaultVisibleColumns,
  encodeFilters,
  formatCell,
  SCHEMA_VERSION_COLUMN,
} from "@/lib/items-table";
import { cn } from "@/lib/utils";
import { BulkActionsBar } from "@/components/data-center/bulk-actions-bar";
import type { ItemFilter, ItemHealthCounts, ItemRow } from "@/lib/data/items";
import type { CategoryNode, EffectiveField } from "@/lib/types";

export function ItemsTable({
  categoryId,
  categoryName,
  schema,
  rows,
  total,
  page,
  pageSize,
  canEdit,
  canManageSchema = false,
  tree,
  includeSubtree = false,
  fullSchema,
  schemasByCategory = {},
  hasChildren = false,
  subtreeCategoryCount = 1,
  subtreeItemCount = 0,
  health,
}: {
  categoryId: string;
  categoryName: string;
  /** Columns to render — the subtree intersection when scoped wide. */
  schema: EffectiveField[];
  rows: ItemRow[];
  total: number;
  page: number;
  pageSize: number;
  canEdit: boolean;
  canManageSchema?: boolean;
  /** Needed by the bulk "move to another category" picker. */
  tree: CategoryNode[];
  includeSubtree?: boolean;
  /** This category's own full schema, for editing its own items. */
  fullSchema?: EffectiveField[];
  /** Per-category schemas, so a subtree row edits against its OWN. */
  schemasByCategory?: Record<string, EffectiveField[]>;
  hasChildren?: boolean;
  subtreeCategoryCount?: number;
  /** Items across this category AND its descendants. */
  subtreeItemCount?: number;
  health?: ItemHealthCounts;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [visible, setVisible] = useState<string[]>(() => defaultVisibleColumns(schema));
  const [openItem, setOpenItem] = useState<ItemRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Selection is per page of results; a new page means a new set.
  useEffect(() => {
    setSelected(new Set());
  }, [rows]);

  const toggleRow = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));

  const storageKey = `schemashift:columns:${categoryId}`;

  // Per-category column choice, restored after mount so SSR agrees.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as string[];
        // A stored key whose field has since been removed is dropped;
        // metadata columns are not in `schema` and must survive it.
        const stillValid = parsed.filter(
          (key) => key === SCHEMA_VERSION_COLUMN || schema.some((f) => f.key === key)
        );
        if (stillValid.length) {
          setVisible(stillValid);
          return;
        }
      }
    } catch {
      // Fall through to defaults.
    }
    setVisible(defaultVisibleColumns(schema));
  }, [storageKey, schema]);

  const updateVisible = (keys: string[]) => {
    setVisible(keys);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(keys));
    } catch {
      // Choice just won't persist.
    }
  };

  const filters = useMemo(
    () => decodeFilters(searchParams.get("f"), schema),
    [searchParams, schema]
  );
  const filterByKey = useMemo(
    () => new Map(filters.map((filter) => [filter.key, filter])),
    [filters]
  );

  const sortKey = searchParams.get("sort");
  const sortDir = searchParams.get("dir") === "desc" ? "desc" : "asc";
  const activeHealth = searchParams.get("health");

  /** Rewrite the URL, keeping every unrelated param intact. */
  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const toggleSort = (field: EffectiveField) => {
    if (sortKey === field.key) {
      setParams({ dir: sortDir === "asc" ? "desc" : "asc", page: null });
    } else {
      setParams({ sort: field.key, type: field.type, dir: "asc", page: null });
    }
  };

  const applyFilter = (filter: ItemFilter) => {
    const next = [...filters.filter((item) => item.key !== filter.key), filter];
    setParams({ f: encodeFilters(next) || null, page: null });
  };

  const clearFilter = (key: string) => {
    const next = filters.filter((item) => item.key !== key);
    setParams({ f: encodeFilters(next) || null, page: null });
  };

  const columns = useMemo(
    () => schema.filter((field) => visible.includes(field.key)),
    [schema, visible]
  );

  // Metadata column, opt-in from the column picker. Shows which schema
  // version each row's data was last written against.
  const showSchemaVersion = visible.includes(SCHEMA_VERSION_COLUMN);
  const latestSchemaVersion = rows.reduce((max, row) => Math.max(max, row.schema_version), 0);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = filters.length > 0;

  return (
    <div className="space-y-3">
      {/* Health strip — each segment is a one-click filter */}
      {health && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => setParams({ health: null, page: null })}
            className={cn(
              "rounded-md px-2 py-1 transition-colors",
              !activeHealth
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {health.total.toLocaleString()} item{health.total === 1 ? "" : "s"}
          </button>

          <span className="text-muted-foreground/50">·</span>

          <button
            type="button"
            disabled={health.incomplete === 0}
            onClick={() =>
              setParams({
                health: activeHealth === "incomplete" ? null : "incomplete",
                page: null,
              })
            }
            className={cn(
              "rounded-md px-2 py-1 transition-colors disabled:opacity-50",
              activeHealth === "incomplete"
                ? "bg-destructive/15 font-medium text-destructive"
                : health.incomplete > 0
                  ? "text-destructive hover:bg-destructive/10"
                  : "text-muted-foreground"
            )}
          >
            {health.incomplete} incomplete
          </button>

          <span className="text-muted-foreground/50">·</span>

          <button
            type="button"
            disabled={health.orphaned === 0}
            onClick={() =>
              setParams({
                health: activeHealth === "orphaned" ? null : "orphaned",
                page: null,
              })
            }
            className={cn(
              "rounded-md px-2 py-1 transition-colors disabled:opacity-50",
              activeHealth === "orphaned"
                ? "bg-warning/20 font-medium text-warning"
                : health.orphaned > 0
                  ? "text-warning hover:bg-warning/10"
                  : "text-muted-foreground"
            )}
          >
            {health.orphaned} with orphaned data
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-muted-foreground">
            {total.toLocaleString()} item{total === 1 ? "" : "s"}
            {hasFilters && <> matching {filters.length} filter{filters.length === 1 ? "" : "s"}</>}
          </p>

          {/* Scope toggle — only meaningful when there is a subtree */}
          {hasChildren && (
            <div
              role="radiogroup"
              aria-label="Item scope"
              className="flex rounded-md border border-border p-0.5"
            >
              {[
                { label: "This category", value: "single" },
                { label: "Include subcategories", value: "subtree" },
              ].map((option) => {
                const active =
                  option.value === "subtree" ? includeSubtree : !includeSubtree;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setParams({ scope: option.value, page: null, f: null })}
                    className={cn(
                      "rounded px-2 py-0.5 text-xs transition-colors",
                      active
                        ? "bg-primary/15 font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => setParams({ f: null, page: null })}>
              Clear filters
            </Button>
          )}
          <ColumnPicker schema={schema} visible={visible} onChange={updateVisible} />
          {/* Scoped to whatever the table is currently showing —
              including the subtree toggle, so what you export is what
              you can see. */}
          <ExportButton
            categoryId={categoryId}
            scopeName={categoryName}
            query={includeSubtree ? "" : ""}
            total={total}
          />
          {canEdit && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add item
            </Button>
          )}
        </div>
      </div>

      {/* Honest account of why the columns narrowed */}
      {includeSubtree && (
        <p className="flex items-start gap-1.5 rounded-md border border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Showing {schema.length} field{schema.length === 1 ? "" : "s"} common to all{" "}
            {subtreeCategoryCount} categor{subtreeCategoryCount === 1 ? "y" : "ies"} in this
            subtree. Switch to <strong className="text-foreground">This category</strong> to see
            its full schema.
          </span>
        </p>
      )}

      {/* The fastest way out of the mess a newly-required field makes:
          filter to incomplete, select all, set one value for the lot. */}
      {canEdit && activeHealth === "incomplete" && rows.length > 0 && selected.size === 0 && (
        <p className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="h-3 w-3 shrink-0" />
          Select these rows and use <strong className="text-foreground">Set a field</strong> to
          fill the same value across all of them.
        </p>
      )}

      {canEdit && selected.size > 0 && (
        <BulkActionsBar
          selected={[...selected]}
          categoryId={categoryId}
          schema={fullSchema ?? schema}
          tree={tree}
          onClear={() => setSelected(new Set())}
        />
      )}

      {/* Table */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
          {hasFilters ? (
            <>
              <p className="text-sm text-foreground">No items match these filters.</p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setParams({ f: null, page: null })}
              >
                Clear filters
              </Button>
            </>
          ) : (
            <>
              {/* A parent whose items all live on its children reads as
                  broken when it says "no items". It is not empty — you
                  are looking at the wrong level, and the fix is one
                  click away. */}
              {hasChildren && !includeSubtree && subtreeItemCount > 0 ? (
                <>
                  <p className="text-sm text-foreground">
                    Items live on {categoryName}&apos;s subcategories.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    There {subtreeItemCount === 1 ? "is" : "are"} {subtreeItemCount} item
                    {subtreeItemCount === 1 ? "" : "s"} across{" "}
                    {subtreeCategoryCount - 1} subcategor
                    {subtreeCategoryCount - 1 === 1 ? "y" : "ies"}.
                  </p>
                  <Button
                    size="sm"
                    className="mt-3"
                    onClick={() => setParams({ scope: "subtree", page: null })}
                  >
                    Show all {subtreeItemCount}
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-foreground">No items in {categoryName} yet.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Items hold the actual data — this category&apos;s schema describes their
                    shape.
                  </p>
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    {canEdit && (
                      <Button size="sm" onClick={() => setCreating(true)}>
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        Add the first item
                      </Button>
                    )}
                    {canManageSchema && (
                      <ImportEntry
                        tree={tree}
                        categoryId={categoryId}
                        label="Import from a file"
                      />
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-card/50">
                {canEdit && (
                  <th data-slot="table-head" className="w-8 px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all rows on this page"
                      checked={allSelected}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
                      }
                      className="h-3.5 w-3.5 rounded border-border"
                    />
                  </th>
                )}

                {/* Pinned handle column */}
                <th
                  data-slot="table-head"
                  className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium text-muted-foreground"
                >
                  Item
                </th>

                {includeSubtree && (
                  <th
                    data-slot="table-head"
                    className="px-3 py-2 text-left font-medium text-muted-foreground"
                  >
                    Category
                  </th>
                )}

                {columns.map((field) => (
                  <th
                    key={field.key}
                    data-slot="table-head"
                    className={cn(
                      "border-t-2 px-3 py-2 text-left font-medium",
                      field.inherited ? "border-t-muted-foreground/25" : "border-t-primary/60"
                    )}
                  >
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => toggleSort(field)}
                        className="flex min-w-0 items-center gap-1 text-foreground hover:text-primary"
                      >
                        <span className="truncate">{field.label}</span>
                        {sortKey === field.key &&
                          (sortDir === "asc" ? (
                            <ArrowUp className="h-3 w-3 shrink-0" />
                          ) : (
                            <ArrowDown className="h-3 w-3 shrink-0" />
                          ))}
                      </button>
                      <ColumnFilter
                        field={field}
                        active={filterByKey.get(field.key)}
                        onApply={applyFilter}
                        onClear={() => clearFilter(field.key)}
                      />
                    </span>
                    {field.inherited && (
                      <span className="block truncate text-[10px] font-normal text-muted-foreground">
                        ({field.source_category_name})
                      </span>
                    )}
                  </th>
                ))}

                {showSchemaVersion && (
                  <th
                    data-slot="table-head"
                    className="px-3 py-2 text-right font-medium text-muted-foreground"
                  >
                    Schema
                  </th>
                )}

                <th
                  data-slot="table-head"
                  className="px-3 py-2 text-right font-medium text-muted-foreground"
                >
                  Complete
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => {
                // Completeness must be judged against the row's OWN
                // schema. Measuring against the subtree intersection
                // would report "3/3 complete" for an item missing four
                // of its own category's fields.
                const rowSchema =
                  schemasByCategory[row.category_id] ?? fullSchema ?? schema;
                const completeness = completenessOf(rowSchema, row.data);
                const incomplete = completeness.missingRequired.length > 0;

                return (
                  <tr
                    key={row.id}
                    onClick={() => setOpenItem(row)}
                    className={cn(
                      "cursor-pointer border-b border-border/50 last:border-0 hover:bg-accent/40",
                      selected.has(row.id) && "bg-primary/5"
                    )}
                  >
                    {canEdit && (
                      <td data-slot="table-cell" className="w-8 px-2 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${displayValueFor(schema, row)}`}
                          checked={selected.has(row.id)}
                          onClick={(event) => event.stopPropagation()}
                          onChange={() => toggleRow(row.id)}
                          className="h-3.5 w-3.5 rounded border-border"
                        />
                      </td>
                    )}

                    <td
                      data-slot="table-cell"
                      className="sticky left-0 z-10 max-w-52 truncate bg-background px-3 py-2 font-medium text-foreground"
                    >
                      {displayValueFor(schema, row)}
                    </td>

                    {includeSubtree && (
                      <td data-slot="table-cell" className="px-3 py-2">
                        <Link
                          href={`/data-center/${row.category_id}?tab=items`}
                          onClick={(event) => event.stopPropagation()}
                          className="text-xs text-primary hover:underline"
                        >
                          {row.category_name}
                        </Link>
                      </td>
                    )}

                    {columns.map((field) => (
                      <td
                        key={field.key}
                        data-slot="table-cell"
                        className="max-w-52 truncate px-3 py-2 text-muted-foreground"
                        title={formatCell(field, row.data?.[field.key])}
                      >
                        {formatCell(field, row.data?.[field.key]) || (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                    ))}

                    {showSchemaVersion && (
                      <td data-slot="table-cell" className="px-3 py-2 text-right">
                        <span
                          className={cn(
                            "text-xs tabular-nums",
                            row.schema_version < latestSchemaVersion
                              ? "text-warning"
                              : "text-muted-foreground"
                          )}
                          title={
                            row.schema_version < latestSchemaVersion
                              ? "Written against an older schema than the newest row here"
                              : undefined
                          }
                        >
                          v{row.schema_version}
                        </span>
                      </td>
                    )}

                    <td data-slot="table-cell" className="px-3 py-2 text-right">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span
                              className={cn(
                                "cursor-default text-xs tabular-nums",
                                incomplete ? "text-destructive" : "text-muted-foreground"
                              )}
                            >
                              {completeness.filled}/{completeness.total}
                            </span>
                          }
                        />
                        <TooltipContent>
                          {completeness.missing.length === 0
                            ? "Every field is filled in"
                            : `Missing: ${completeness.missing.join(", ")}`}
                        </TooltipContent>
                      </Tooltip>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setParams({ page: String(page - 1) })}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setParams({ page: String(page + 1) })}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Row detail / create.
          In the subtree view the table shows only the common columns,
          but editing must offer the item's OWN category's full schema —
          otherwise opening a Gaming Laptop from the Electronics view
          would silently hide half its fields. */}
      <ItemSheet
        open={Boolean(openItem) || creating}
        onOpenChange={(next) => {
          if (!next) {
            setOpenItem(null);
            setCreating(false);
          }
        }}
        categoryId={openItem?.category_id ?? categoryId}
        categoryName={openItem?.category_name ?? categoryName}
        schema={
          openItem
            ? schemasByCategory[openItem.category_id] ?? fullSchema ?? schema
            : fullSchema ?? schema
        }
        item={openItem}
        canEdit={canEdit}
        canManageSchema={canManageSchema}
      />
    </div>
  );
}
