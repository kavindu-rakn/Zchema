'use client'

import { useState } from 'react'
import { Template, TemplateField, FieldType } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Plus, Trash2, Save, ArrowUp, ArrowDown } from 'lucide-react'
import { motion, Reorder } from 'framer-motion'

interface TemplateBuilderProps {
  initialData?: Partial<Template> | null
  onSave: (data: Partial<Template>) => Promise<void>
}

export function TemplateBuilder({ initialData, onSave }: TemplateBuilderProps) {
  const [name, setName] = useState(initialData?.name || '')
  const [description, setDescription] = useState(initialData?.description || '')
  const [fields, setFields] = useState<TemplateField[]>(initialData?.fields || [])
  const [isSaving, setIsSaving] = useState(false)

  const handleAddField = () => {
    const newField: TemplateField = {
      key: `field_${Date.now()}`,
      label: 'New Field',
      type: 'string',
      required: false,
    }
    setFields([...fields, newField])
  }

  const handleRemoveField = (key: string) => {
    setFields(fields.filter((field) => field.key !== key))
  }

  const handleUpdateField = (index: number, updates: Partial<TemplateField>) => {
    const newFields = [...fields]
    newFields[index] = { ...newFields[index], ...updates }
    setFields(newFields)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await onSave({ name, description, fields })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <Card className="bg-zinc-950 border-zinc-800">
        <CardContent className="p-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Template Name</Label>
            <Input
              id="name"
              placeholder="e.g. BlogPost"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-zinc-900 border-zinc-800"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Describe this template..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="bg-zinc-900 border-zinc-800 min-h-[100px]"
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Fields</h3>
          <Button onClick={handleAddField} variant="outline" size="sm" className="bg-zinc-950 border-zinc-800">
            <Plus className="mr-2 h-4 w-4" />
            Add Field
          </Button>
        </div>

        <div className="space-y-4">
          <Reorder.Group axis="y" values={fields} onReorder={setFields} className="space-y-4">
            {fields.map((field, index) => (
              <Reorder.Item key={field.key} value={field}>
                <Card className="bg-zinc-950 border-zinc-800 relative shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing">
                  <CardContent className="p-4 flex gap-4 items-start">
                    <div className="flex flex-col gap-1 mt-2 text-zinc-500 justify-center items-center h-full pt-1">
                      <ArrowUp className="h-4 w-4 opacity-50" />
                      <ArrowDown className="h-4 w-4 opacity-50" />
                    </div>
                    
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Label</Label>
                        <Input
                          value={field.label}
                          onChange={(e) => handleUpdateField(index, { label: e.target.value })}
                          className="bg-zinc-900 border-zinc-800"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Key (Internal)</Label>
                        <Input
                          value={field.key}
                          onChange={(e) => handleUpdateField(index, { key: e.target.value })}
                          className="bg-zinc-900 border-zinc-800"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Type</Label>
                        <Select
                          value={field.type}
                          onValueChange={(val) => val && handleUpdateField(index, { type: val as FieldType })}
                        >
                          <SelectTrigger className="bg-zinc-900 border-zinc-800">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="string">Text</SelectItem>
                            <SelectItem value="number">Number</SelectItem>
                            <SelectItem value="boolean">Boolean</SelectItem>
                            <SelectItem value="date">Date</SelectItem>
                            <SelectItem value="select">Select (Dropdown)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2 flex flex-col justify-center">
                        <Label className="mb-2">Required</Label>
                        <div className="flex items-center space-x-2">
                          <Switch
                            checked={field.required}
                            onCheckedChange={(checked) => handleUpdateField(index, { required: checked })}
                          />
                          <span className="text-sm text-zinc-400">{field.required ? 'Yes' : 'No'}</span>
                        </div>
                      </div>

                      {field.type === 'select' && (
                        <div className="space-y-2 md:col-span-2">
                          <Label>Options (comma separated)</Label>
                          <Input
                            value={field.options?.join(', ') || ''}
                            onChange={(e) => handleUpdateField(index, { options: e.target.value.split(',').map(s => s.trim()) })}
                            placeholder="Option 1, Option 2, Option 3"
                            className="bg-zinc-900 border-zinc-800"
                          />
                        </div>
                      )}
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveField(field.key)}
                      className="text-red-500 hover:text-red-400 hover:bg-red-950/30"
                    >
                      <Trash2 className="h-5 w-5" />
                    </Button>
                  </CardContent>
                </Card>
              </Reorder.Item>
            ))}
          </Reorder.Group>

          {fields.length === 0 && (
            <div className="text-center py-12 text-zinc-500 border border-dashed border-zinc-800 rounded-lg">
              No fields added yet. Click "Add Field" to start.
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <Button onClick={handleSave} disabled={isSaving || !name.trim()} className="bg-emerald-600 hover:bg-emerald-700 text-white">
          <Save className="mr-2 h-4 w-4" />
          {isSaving ? 'Saving...' : 'Save Template'}
        </Button>
      </div>
    </div>
  )
}
