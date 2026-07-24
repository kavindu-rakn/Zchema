"use client";

import { useState } from "react";
import { Template } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

interface DynamicFormProps {
  template: Template;
  initialData?: Record<string, any>;
  onSubmit: (data: Record<string, any>) => Promise<void>;
  onCancel?: () => void;
}

export function DynamicForm({ template, initialData = {}, onSubmit, onCancel }: DynamicFormProps) {
  const [formData, setFormData] = useState<Record<string, any>>(initialData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (key: string, value: any) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(formData);
    } catch (err: any) {
      setError(err.message || "Failed to submit form");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-md">
          {error}
        </div>
      )}
      
      <div className="space-y-4">
        {template.fields.map((field) => (
          <div key={field.key} className="space-y-2">
            <Label htmlFor={field.key} className="flex items-center gap-1">
              {field.label}
              {field.required && <span className="text-red-500">*</span>}
            </Label>
            
            {field.type === "string" && (
              <Input
                id={field.key}
                required={field.required}
                value={formData[field.key] || ""}
                onChange={(e) => handleChange(field.key, e.target.value)}
                placeholder={`Enter ${field.label.toLowerCase()}`}
              />
            )}

            {field.type === "number" && (
              <Input
                id={field.key}
                type="number"
                required={field.required}
                value={formData[field.key] || ""}
                onChange={(e) => handleChange(field.key, e.target.value === "" ? "" : Number(e.target.value))}
                placeholder={`Enter ${field.label.toLowerCase()}`}
              />
            )}

            {field.type === "date" && (
              <Input
                id={field.key}
                type="date"
                required={field.required}
                value={formData[field.key] || ""}
                onChange={(e) => handleChange(field.key, e.target.value)}
              />
            )}

            {field.type === "boolean" && (
              <div className="flex items-center h-10">
                <Switch
                  id={field.key}
                  checked={Boolean(formData[field.key])}
                  onCheckedChange={(checked) => handleChange(field.key, checked)}
                />
              </div>
            )}

            {field.type === "select" && (
              <Select
                required={field.required}
                value={formData[field.key] || ""}
                onValueChange={(value) => handleChange(field.key, value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
                </SelectTrigger>
                <SelectContent>
                  {field.options?.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-zinc-800">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {initialData.id ? "Update" : "Save"}
        </Button>
      </div>
    </form>
  );
}
