// ── TypeScript types for SchemaShift ─────────────────────────

/** User roles matching the CHECK constraint in profiles table */
export type UserRole = "TEMPLATE_ADMIN" | "DATA_CONTRIBUTOR" | "VIEWER";

/** Field types supported by the template builder */
export type FieldType = "string" | "number" | "boolean" | "date" | "select";

/** A single field definition within a template's `fields` JSONB array */
export interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[]; // Only used when type === "select"
}

/** profiles table row */
export interface Profile {
  id: string;
  email: string;
  role: UserRole;
  created_at: string;
}

/** templates table row */
export interface Template {
  id: string;
  name: string;
  description: string | null;
  fields: TemplateField[];
  created_at: string;
}

/** categories table row */
export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  template_id: string;
  created_at: string;
}

/** categories with nested children (for tree rendering) */
export interface CategoryNode extends Category {
  children: CategoryNode[];
  template?: Template;
}

/** items table row */
export interface Item {
  id: string;
  category_id: string;
  data: Record<string, unknown>;
  created_at: string;
}

/** items joined with its category (for display) */
export interface ItemWithCategory extends Item {
  category?: Category;
}
