-- ============================================================
-- SchemaShift — Integrity Triggers (Phase 1, Increment 3)
-- Source this AFTER functions.sql (it calls get_category_ancestors
-- and get_category_subtree).
--
-- Load order:  schema.sql  →  functions.sql  →  triggers.sql
--
-- All raised messages are written to surface directly in UI toasts,
-- so they are phrased for humans.
-- ============================================================


-- ============================================================
-- 1. validate_category_fields()
-- ------------------------------------------------------------
-- Fires BEFORE INSERT/UPDATE of own_fields, overrides or parent_id.
-- Enforces, in order:
--   A. shape of every own_field (key / type / options / position)
--   B. key uniqueness WITHIN own_fields
--   C. key must not collide with any ANCESTOR field  (no redefining
--      inherited fields — use an override instead)
--   D. key must not collide with any DESCENDANT field
--   E. override guard: target key must be inherited, and a patch may
--      not carry `type` or `key`.
--
-- NOTE ON TIMING: in a BEFORE trigger the target row still holds its
-- OLD values, so we resolve the ancestor chain from NEW.parent_id
-- (strict ancestors) and the descendant set from get_category_subtree
-- (NEW.id) minus the node itself. For a brand-new INSERT the node is
-- not yet in the table, so it has no descendants — correct.
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_category_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  fld           JSONB;
  k             TEXT;
  t             TEXT;
  dup           TEXT;
  anc_keys      TEXT[];
  desc_keys     TEXT[];
  o_key         TEXT;
  o_patch       JSONB;
  allowed_types TEXT[] := ARRAY['string','text','number','boolean','date','select','multiselect','url'];
BEGIN
  -- ── A. shape of every own_field ───────────────────────────
  IF jsonb_typeof(COALESCE(NEW.own_fields, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'own_fields must be a JSON array';
  END IF;

  FOR fld IN SELECT value FROM jsonb_array_elements(NEW.own_fields) LOOP
    k := fld->>'key';
    t := fld->>'type';

    IF k IS NULL OR k !~ '^[a-z][a-z0-9_]*$' THEN
      RAISE EXCEPTION 'Invalid field key "%": use snake_case matching ^[a-z][a-z0-9_]*$', COALESCE(k, '(missing)');
    END IF;

    IF t IS NULL OR NOT (t = ANY(allowed_types)) THEN
      RAISE EXCEPTION 'Field "%" has invalid type "%": must be one of string, text, number, boolean, date, select, multiselect, url',
        k, COALESCE(t, '(missing)');
    END IF;

    IF t IN ('select', 'multiselect') THEN
      IF jsonb_typeof(fld->'options') <> 'array'
         OR jsonb_array_length(COALESCE(fld->'options', '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'Field "%" of type % requires a non-empty "options" array', k, t;
      END IF;
    END IF;

    -- position is optional at the storage layer (the resolver defaults it
    -- to 0); when present it must be an integer.
    IF fld ? 'position'
       AND (jsonb_typeof(fld->'position') <> 'number'
            OR (fld->>'position')::numeric <> floor((fld->>'position')::numeric)) THEN
      RAISE EXCEPTION 'Field "%" position must be an integer', k;
    END IF;
  END LOOP;

  -- ── B. duplicate key within own_fields ────────────────────
  SELECT f->>'key' INTO dup
  FROM jsonb_array_elements(NEW.own_fields) f
  GROUP BY f->>'key' HAVING count(*) > 1
  LIMIT 1;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate field key "%" within this category', dup;
  END IF;

  -- ── collect ancestor keys (strict ancestors: walk from parent)
  SELECT array_agg(DISTINCT af.elem->>'key') INTO anc_keys
  FROM public.get_category_ancestors(NEW.parent_id) a
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.own_fields, '[]'::jsonb)) AS af(elem);

  -- ── collect descendant keys (strict descendants of NEW.id) ─
  SELECT array_agg(DISTINCT df.elem->>'key') INTO desc_keys
  FROM public.get_category_subtree(NEW.id) sub
  JOIN public.categories c ON c.id = sub.id AND c.id <> NEW.id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.own_fields, '[]'::jsonb)) AS df(elem);

  -- ── C + D. own keys must not collide up or down the chain ──
  FOR fld IN SELECT value FROM jsonb_array_elements(NEW.own_fields) LOOP
    k := fld->>'key';
    IF anc_keys IS NOT NULL AND k = ANY(anc_keys) THEN
      RAISE EXCEPTION 'Field key "%" is already defined by an ancestor category; inherited fields cannot be redefined — use an override instead', k;
    END IF;
    IF desc_keys IS NOT NULL AND k = ANY(desc_keys) THEN
      RAISE EXCEPTION 'Field key "%" is already defined by a descendant category', k;
    END IF;
  END LOOP;

  -- ── C2. ancestor keys and descendant keys must stay disjoint ──
  -- Catches a re-parent (or any change) that would make an EXISTING
  -- descendant redefine a field it now inherits from the new chain —
  -- the descendant's own trigger does not fire on a move of this node.
  IF anc_keys IS NOT NULL AND desc_keys IS NOT NULL AND (anc_keys && desc_keys) THEN
    RAISE EXCEPTION 'This change would make a descendant category redefine an inherited field (key %)',
      (SELECT string_agg(x, ', ') FROM unnest(anc_keys) x WHERE x = ANY(desc_keys));
  END IF;

  -- ── E. override guard ─────────────────────────────────────
  IF jsonb_typeof(COALESCE(NEW.overrides, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'overrides must be a JSON object';
  END IF;

  FOR o_key, o_patch IN SELECT key, value FROM jsonb_each(NEW.overrides) LOOP
    IF jsonb_typeof(o_patch) <> 'object' THEN
      RAISE EXCEPTION 'Override for "%" must be a JSON object', o_key;
    END IF;
    IF anc_keys IS NULL OR NOT (o_key = ANY(anc_keys)) THEN
      RAISE EXCEPTION 'Override targets "%", which is not an inherited field of this category', o_key;
    END IF;
    IF o_patch ? 'type' OR o_patch ? 'key' THEN
      RAISE EXCEPTION 'Override for "%" may not change "type" or "key"', o_key;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS categories_validate_fields ON public.categories;
CREATE TRIGGER categories_validate_fields
  BEFORE INSERT OR UPDATE OF own_fields, overrides, parent_id ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.validate_category_fields();


-- ============================================================
-- 2. generate_category_slug()
-- ------------------------------------------------------------
-- BEFORE INSERT: if slug is null/blank, derive it from name
-- (lowercase → non-alphanumerics to '-' → collapse repeats → trim).
-- On collision within the same parent, append -2, -3, …
-- An explicitly-provided slug is respected as-is.
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_category_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  base_slug TEXT;
  candidate TEXT;
  n         INT := 2;
BEGIN
  IF NEW.slug IS NOT NULL AND btrim(NEW.slug) <> '' THEN
    RETURN NEW;  -- respect an explicit slug
  END IF;

  base_slug := lower(COALESCE(NEW.name, ''));
  base_slug := regexp_replace(base_slug, '[^a-z0-9]+', '-', 'g');
  base_slug := regexp_replace(base_slug, '-+', '-', 'g');
  base_slug := btrim(base_slug, '-');
  IF base_slug = '' THEN
    base_slug := 'category';
  END IF;

  candidate := base_slug;
  WHILE EXISTS (
    SELECT 1 FROM public.categories c
    WHERE c.slug = candidate
      AND c.id <> NEW.id
      AND c.parent_id IS NOT DISTINCT FROM NEW.parent_id
  ) LOOP
    candidate := base_slug || '-' || n;
    n := n + 1;
  END LOOP;

  NEW.slug := candidate;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS categories_generate_slug ON public.categories;
CREATE TRIGGER categories_generate_slug
  BEFORE INSERT ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.generate_category_slug();


-- ============================================================
-- Trigger fire order on categories (alphabetical within BEFORE):
--   1. categories_generate_slug     (INSERT: fill slug first)
--   2. categories_no_cycle          (parent_id: reject cycles)
--   3. categories_validate_fields   (fields/overrides integrity)
-- ============================================================
