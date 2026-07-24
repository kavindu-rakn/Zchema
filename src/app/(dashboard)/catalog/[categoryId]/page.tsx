import { fetchCategoryWithTemplate, fetchItems } from "../actions";
import { ItemsDataTable } from "@/components/items-data-table";
import { AddItemDialog } from "@/components/add-item-dialog";
import { notFound } from "next/navigation";
import { Metadata } from "next";

interface CatalogPageProps {
  params: Promise<{
    categoryId: string;
  }>;
}

export async function generateMetadata({ params }: CatalogPageProps): Promise<Metadata> {
  const { categoryId } = await params;
  try {
    const { category } = await fetchCategoryWithTemplate(categoryId);
    return {
      title: `${category.name} | SchemaShift`,
    };
  } catch {
    return {
      title: "Category Not Found | SchemaShift",
    };
  }
}

export default async function CatalogPage({ params }: CatalogPageProps) {
  const { categoryId } = await params;
  let categoryWithTemplate;
  let items;

  try {
    categoryWithTemplate = await fetchCategoryWithTemplate(categoryId);
    items = await fetchItems(categoryId);
  } catch (error) {
    console.error("Error loading category:", error);
    notFound();
  }

  const { category, template } = categoryWithTemplate;

  return (
    <div className="flex flex-col h-full gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100 tracking-tight">
            {category.name}
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Using template: <span className="font-medium text-zinc-300">{template.name}</span>
          </p>
        </div>
        <AddItemDialog categoryId={category.id} template={template} />
      </div>

      <div className="flex-1">
        <ItemsDataTable 
          template={template} 
          items={items} 
          categoryId={category.id} 
        />
      </div>
    </div>
  );
}
