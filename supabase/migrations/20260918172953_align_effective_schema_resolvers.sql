-- ============================================================
-- Make the three effective-schema resolvers agree
-- ------------------------------------------------------------
-- get_effective_schema() and resolve_schema_preview() now follow the
-- same rules as resolveEffectiveSchema() in src/lib/schema.ts:
--   * a field whose key is missing, empty or not a string is skipped
--     (SQL used to keep an empty key);
--   * an override patch that is not an object is skipped
--     (get_effective_schema used to raise on one);
--   * position is read with try_numeric, so "first" sorts as 0 instead
--     of aborting the query, and "1" sorts as 1 in every copy;
--   * ties sort by label and then key, by code point (COLLATE "C"),
--     so every implementation orders them identically.
-- Proven against supabase/tests/fixtures/resolver-cases.json by
-- src/lib/schema.test.ts and supabase/tests/resolver_differential_test.sql.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_effective_schema(p_category_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  anc      RECORD;
  fld      JSONB;
  acc      JSONB := '[]'::jsonb;               -- ordered accumulator
  seen     TEXT[] := ARRAY[]::TEXT[];          -- keys already accumulated
  k        TEXT;
  o_key    TEXT;                               -- override target key
  o_patch  JSONB;                              -- override patch object
  p_key    TEXT;                               -- patch property key
  p_val    JSONB;                              -- patch property value
  idx      INT;
  cur      JSONB;
  patched  JSONB;
  allowed  TEXT[] := ARRAY['label','required','options','default','help_text','position'];
BEGIN
  -- ── Pass 1: fold own_fields, root → target ─────────────────
  FOR anc IN
    SELECT * FROM public.get_category_ancestors(p_category_id) ORDER BY depth DESC
  LOOP
    IF jsonb_typeof(COALESCE(anc.own_fields, '[]'::jsonb)) <> 'array' THEN
      CONTINUE;
    END IF;
    FOR fld IN SELECT value FROM jsonb_array_elements(anc.own_fields)
    LOOP
      k := fld->>'key';
      IF jsonb_typeof(fld->'key') IS DISTINCT FROM 'string' OR k = '' THEN CONTINUE; END IF;
      IF k = ANY(seen) THEN CONTINUE; END IF;   -- duplicate: skip, never throw
      seen := array_append(seen, k);
      acc := acc || jsonb_build_array(
        fld
        || jsonb_build_object(
             'source_category_id',   anc.id,
             'source_category_name', anc.name,
             'depth',                anc.depth,
             'inherited',            anc.depth > 0,
             'overridden_by',        '[]'::jsonb
           )
      );
    END LOOP;
  END LOOP;

  -- ── Pass 2: apply overrides, root → target ─────────────────
  FOR anc IN
    SELECT * FROM public.get_category_ancestors(p_category_id) ORDER BY depth DESC
  LOOP
    IF jsonb_typeof(COALESCE(anc.overrides, '{}'::jsonb)) <> 'object' THEN
      CONTINUE;
    END IF;
    FOR o_key, o_patch IN SELECT key, value FROM jsonb_each(anc.overrides)
    LOOP
      -- jsonb_each() below raises on anything but an object, which used to
      -- take the whole resolver down over one malformed patch.
      CONTINUE WHEN jsonb_typeof(o_patch) <> 'object';
      FOR idx IN 0 .. jsonb_array_length(acc) - 1
      LOOP
        cur := acc->idx;
        IF cur->>'key' = o_key THEN
          patched := cur;
          FOR p_key, p_val IN SELECT key, value FROM jsonb_each(o_patch)
          LOOP
            IF p_key = ANY(allowed) THEN
              patched := patched || jsonb_build_object(p_key, p_val);
            END IF;
          END LOOP;
          patched := jsonb_set(
            patched, '{overridden_by}',
            COALESCE(patched->'overridden_by', '[]'::jsonb) || to_jsonb(anc.id)
          );
          acc := jsonb_set(acc, ARRAY[idx::text], patched);
          EXIT;  -- one field per key; stop scanning
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- ── Pass 3: sort (depth, position, label, key) ─────────────
  -- try_numeric, not ::numeric: a stray non-numeric position must sort
  -- as 0, not abort the most-called function in the system. COLLATE "C"
  -- orders by code point, matching the TypeScript mirror exactly, and the
  -- key breaks any remaining tie so the order is total.
  SELECT COALESCE(
           jsonb_agg(e ORDER BY (e->>'depth')::int DESC,
                                COALESCE(public.try_numeric(e->>'position'), 0) ASC,
                                COALESCE(e->>'label', '') COLLATE "C" ASC,
                                (e->>'key') COLLATE "C" ASC),
           '[]'::jsonb)
    INTO acc
  FROM jsonb_array_elements(acc) e;

  RETURN acc;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_schema_preview(
  p_category_id    UUID,
  p_new_own_fields JSONB,
  p_new_overrides  JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  anc       RECORD;
  fld       JSONB;
  acc       JSONB := '[]'::jsonb;
  seen      TEXT[] := ARRAY[]::TEXT[];
  k         TEXT;
  o_key     TEXT;
  o_patch   JSONB;
  p_key     TEXT;
  p_val     JSONB;
  idx       INT;
  cur       JSONB;
  patched   JSONB;
  eff_own   JSONB;
  eff_over  JSONB;
  allowed   TEXT[] := ARRAY['label','required','options','default','help_text','position'];
BEGIN
  -- Pass 1: fold own_fields, root → target, substituting at the target.
  FOR anc IN
    SELECT * FROM public.get_category_ancestors(p_category_id) ORDER BY depth DESC
  LOOP
    eff_own := CASE WHEN anc.id = p_category_id
                    THEN COALESCE(p_new_own_fields, anc.own_fields)
                    ELSE anc.own_fields END;

    IF jsonb_typeof(COALESCE(eff_own, '[]'::jsonb)) <> 'array' THEN CONTINUE; END IF;

    FOR fld IN SELECT value FROM jsonb_array_elements(eff_own)
    LOOP
      k := fld->>'key';
      IF jsonb_typeof(fld->'key') IS DISTINCT FROM 'string' OR k = '' THEN CONTINUE; END IF;
      IF k = ANY(seen) THEN CONTINUE; END IF;
      seen := array_append(seen, k);
      acc := acc || jsonb_build_array(
        fld || jsonb_build_object(
          'source_category_id',   anc.id,
          'source_category_name', anc.name,
          'depth',                anc.depth,
          'inherited',            anc.depth > 0,
          'overridden_by',        '[]'::jsonb
        )
      );
    END LOOP;
  END LOOP;

  -- Pass 2: apply overrides, root → target, substituting at the target.
  FOR anc IN
    SELECT * FROM public.get_category_ancestors(p_category_id) ORDER BY depth DESC
  LOOP
    eff_over := CASE WHEN anc.id = p_category_id
                     THEN COALESCE(p_new_overrides, anc.overrides)
                     ELSE anc.overrides END;

    IF jsonb_typeof(COALESCE(eff_over, '{}'::jsonb)) <> 'object' THEN CONTINUE; END IF;

    FOR o_key, o_patch IN SELECT key, value FROM jsonb_each(eff_over)
    LOOP
      CONTINUE WHEN jsonb_typeof(o_patch) <> 'object';
      FOR idx IN 0 .. jsonb_array_length(acc) - 1
      LOOP
        cur := acc->idx;
        IF cur->>'key' = o_key THEN
          patched := cur;
          FOR p_key, p_val IN SELECT key, value FROM jsonb_each(o_patch)
          LOOP
            IF p_key = ANY(allowed) THEN
              patched := patched || jsonb_build_object(p_key, p_val);
            END IF;
          END LOOP;
          patched := jsonb_set(
            patched, '{overridden_by}',
            COALESCE(patched->'overridden_by', '[]'::jsonb) || to_jsonb(anc.id)
          );
          acc := jsonb_set(acc, ARRAY[idx::text], patched);
          EXIT;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- Pass 3: sort (depth, position, label, key) — as get_effective_schema.
  SELECT COALESCE(
           jsonb_agg(e ORDER BY (e->>'depth')::int DESC,
                                COALESCE(public.try_numeric(e->>'position'), 0) ASC,
                                COALESCE(e->>'label', '') COLLATE "C" ASC,
                                (e->>'key') COLLATE "C" ASC),
           '[]'::jsonb)
    INTO acc
  FROM jsonb_array_elements(acc) e;

  RETURN acc;
END;
$$;
