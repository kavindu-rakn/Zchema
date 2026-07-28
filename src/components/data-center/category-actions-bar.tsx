"use client";

// ── Edit / move / delete for the open category ───────────────
// The same flows the tree's row menu opens, surfaced on the detail
// pane so they are reachable without hunting for a hover target.

import { useState } from "react";
import { FolderInput, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CategorySheet } from "@/components/data-center/category-sheet";
import { MoveCategoryDialog } from "@/components/data-center/move-category-dialog";
import { DeleteCategoryDialog } from "@/components/data-center/delete-category-dialog";
import type { Category, CategoryNode } from "@/lib/types";

export function CategoryActionsBar({
  category,
  tree,
  descendantCount,
  subtreeItemCount,
  variant = "header",
}: {
  category: Category;
  tree: CategoryNode[];
  descendantCount: number;
  subtreeItemCount: number;
  variant?: "header" | "danger";
}) {
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      {variant === "header" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMoving(true)}>
            <FolderInput className="mr-1.5 h-3.5 w-3.5" />
            Move
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          onClick={() => setDeleting(true)}
          className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete category
        </Button>
      )}

      <CategorySheet open={editing} onOpenChange={setEditing} category={category} />
      <MoveCategoryDialog
        open={moving}
        onOpenChange={setMoving}
        category={category}
        tree={tree}
      />
      <DeleteCategoryDialog
        open={deleting}
        onOpenChange={setDeleting}
        categoryId={category.id}
        categoryName={category.name}
        descendantCount={descendantCount}
        subtreeItemCount={subtreeItemCount}
      />
    </>
  );
}
