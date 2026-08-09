```text
Act as a Principal Full-Stack Engineer and Software Architect. We are building a high-performance, metadata-driven Dynamic Catalog Engine named "SchemaShift" (or "OmniCatalog").

The design and UI/UX must mirror the dark-mode, minimalist, developer-first aesthetic of platforms like Supabase and Resend (using a zinc/slate dark palette, subtle borders, crisp micro-interactions, clean typography, and a Command Palette via `cmdk`).

---

### Tech Stack & Architecture
- **Framework:** Next.js (App Router) with TypeScript
- **Database & Auth:** Supabase (PostgreSQL with native `JSONB` storage + Supabase Auth)
- **Styling & Components:** Tailwind CSS, shadcn/ui, Lucide React Icons, Framer Motion
- **State & Data Fetching:** React Server Components, Server Actions, and `@supabase/ssr`

---

### 1. Database Schema & Supabase Setup (`schema.sql`)

Provide a SQL migration script for Supabase defining 4 core tables and Row Level Security (RLS) policies:

1. `profiles`
   - `id` (UUID, primary key, references `auth.users.id` ON DELETE CASCADE)
   - `email` (TEXT)
   - `role` (TEXT, check constraint: `role IN ('TEMPLATE_ADMIN', 'DATA_CONTRIBUTOR', 'VIEWER')`, default 'VIEWER')
   - `created_at` (TIMESTAMPTZ, default `now()`)

2. `templates`
   - `id` (UUID, primary key, default `gen_random_uuid()`)
   - `name` (TEXT, e.g., "Vehicles", "Electronics")
   - `description` (TEXT)
   - `fields` (JSONB, array of field objects: `[{ key, label, type, options, required }]`)
     - `type` options: `'string' | 'number' | 'boolean' | 'date' | 'select'`
   - `created_at` (TIMESTAMPTZ, default `now()`)

3. `categories`
   - `id` (UUID, primary key, default `gen_random_uuid()`)
   - `name` (TEXT, e.g., "Cars", "Petrol", "Electric")
   - `parent_id` (UUID, nullable, references `categories(id)` ON DELETE CASCADE)
   - `template_id` (UUID, references `templates(id)` ON DELETE RESTRICT)
   - `created_at` (TIMESTAMPTZ, default `now()`)

4. `items`
   - `id` (UUID, primary key, default `gen_random_uuid()`)
   - `category_id` (UUID, references `categories(id)` ON DELETE CASCADE)
   - `data` (JSONB, dynamic key-value pairs matching the assigned template fields)
   - `created_at` (TIMESTAMPTZ, default `now()`)

5. **Indexes & RLS Policies:**
   - Create a GIN index on `items USING gin (data)` for fast dynamic JSON queries.
   - Configure Supabase RLS Policies:
     - `TEMPLATE_ADMIN`: Full access (SELECT, INSERT, UPDATE, DELETE) across all tables.
     - `DATA_CONTRIBUTOR`: SELECT on `profiles`, `templates`, `categories`; Full access on `items`.
     - `VIEWER`: SELECT-only on `templates`, `categories`, and `items`.

---

### 2. Core Features & UI Layout

1. **Supabase / Resend Inspired Design System:**
   - Dark theme enabled by default (`bg-zinc-950 text-zinc-100 border-zinc-800`).
   - Command Palette modal (`Cmd + K` / `Ctrl + K`) using `cmdk` to jump between templates, categories, and settings.
   - Clean top navigation bar showing active user role badge and a role switcher modal (for local testing/debugging).

2. **Template Builder Component (`TEMPLATE_ADMIN` Only):**
   - Dynamic form builder allowing admins to name a template and interactively add, configure, reorder, or remove custom fields (`key`, `label`, `type`, `required`, `options`).

3. **Hierarchical Category Tree Visualizer:**
   - Interactive tree/folder view displaying nested parent-child categories (e.g., `Vehicles -> Cars -> Petrol`).
   - Ability to add subcategories and link them to a specific Template.

4. **Dynamic Item Form Renderer (`DATA_CONTRIBUTOR` & `TEMPLATE_ADMIN`):**
   - When a user selects a category to add an item, fetch the associated `template.fields`.
   - Automatically generate appropriate shadcn/ui input fields based on field types (`string` -> Input, `number` -> Number Input, `boolean` -> Switch, `select` -> Select dropdown, etc.).

5. **Data Grid Catalog Viewer:**
   - Dynamic table view rendering `items` under selected categories.
   - Automatically extract JSON keys into table columns.
   - Include search, sorting, and JSON filtering capabilities.

---

### 3. Step-by-Step Implementation Instructions for AntiGravity

Execute this project sequentially in modular steps:

**Phase 1: Environment & Project Setup**
- Initialize Next.js (App Router) with TypeScript, Tailwind CSS, shadcn/ui, and Lucide Icons.
- Install `@supabase/supabase-js`, `@supabase/ssr`, and `cmdk`.
- Create `.env.local` template with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

**Phase 2: Database Migration & Supabase Client Setup**
- Generate `supabase/schema.sql` containing all table definitions, GIN indexing, trigger functions for profile creation on signup, and RLS policies.
- Build server-side (`utils/supabase/server.ts`) and client-side (`utils/supabase/client.ts`) Supabase utilities.

**Phase 3: Auth & Dynamic Layout Shell**
- Build Auth routes (`/login`, `/signup`) and middleware for role checks.
- Build main App Dashboard shell with dark-mode sidebar, header with active role indicator, and Command Palette (`Cmd + K`).

**Phase 4: Template & Category Builder Features**
- Build `/templates` routes (Template List and Interactive Builder).
- Build `/categories` route with dynamic recursive hierarchy view.

**Phase 5: Dynamic Item CRUD & Data Table**
- Build dynamic form parser component that renders UI controls from a `Template` JSON definition.
- Build `/catalog` route displaying dynamic table grids populated from `items.data`.

**Phase 6: Seed Script & Verification**
- Create `supabase/seed.sql` pre-populating:
  - 3 Test profiles (Admin, Contributor, Viewer).
  - 1 "Vehicles" Template with fields (`brand`, `modelYear`, `isElectric`, `fuelType`).
  - Hierarchical categories (`Vehicles` -> `Cars` -> `Petrol`).
  - 2 sample `items` with dynamic `JSONB` data.

Let's begin by scaffolding the Next.js project directory, configuring Tailwind CSS dark mode with shadcn/ui defaults, and setting up the Supabase database schema and client utilities.

```