BEGIN;
-- Preserve the official PDF's descending scale order, also allow ascending editor scales.
CREATE OR REPLACE FUNCTION cqa_valid_editor_criterion(cfg jsonb, max_points numeric)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  item jsonb;
  previous numeric;
  current_value numeric;
  weight numeric;
  direction integer := 0;
  difference integer;
  highest numeric := 0;
  has_zero boolean := false;
BEGIN
  IF NOT (cfg ? 'schemaVersion') THEN RETURN true; END IF;
  IF cfg->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR cfg->>'type' IS NULL OR cfg->>'type' NOT IN ('boolean', 'scale', 'flag')
    OR jsonb_typeof(cfg->'description') IS DISTINCT FROM 'string' OR length(btrim(cfg->>'description')) = 0
    OR jsonb_typeof(cfg->'sectionKey') IS DISTINCT FROM 'string' OR length(btrim(cfg->>'sectionKey')) = 0
    OR jsonb_typeof(cfg->'weight') IS DISTINCT FROM 'number'
    OR jsonb_typeof(cfg->'allowNa') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(cfg->'scaleSteps') IS DISTINCT FROM 'array'
    OR jsonb_typeof(cfg->'position') IS DISTINCT FROM 'number'
    OR (cfg->>'position') !~ '^[0-9]+$'
  THEN RETURN false; END IF;
  weight := (cfg->>'weight')::numeric;
  IF weight < 0 OR weight > 100 OR weight <> round(weight, 2) THEN RETURN false; END IF;
  IF (cfg->>'allowNa')::boolean THEN
    IF jsonb_typeof(cfg->'naCondition') IS DISTINCT FROM 'string' OR length(btrim(cfg->>'naCondition')) = 0 THEN RETURN false; END IF;
  ELSIF cfg->'naCondition' IS DISTINCT FROM 'null'::jsonb THEN RETURN false;
  END IF;
  IF cfg->>'type' = 'flag' THEN
    RETURN weight = 0 AND max_points = 0 AND cfg->'allowNa' = 'false'::jsonb AND jsonb_array_length(cfg->'scaleSteps') = 0;
  END IF;
  IF weight <= 0 OR max_points <= 0 THEN RETURN false; END IF;
  IF cfg->>'type' = 'boolean' THEN
    RETURN max_points = 1 AND jsonb_array_length(cfg->'scaleSteps') = 0;
  END IF;
  IF jsonb_array_length(cfg->'scaleSteps') < 2 OR jsonb_array_length(cfg->'scaleSteps') > 50 THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(cfg->'scaleSteps') LOOP
    IF jsonb_typeof(item->'value') IS DISTINCT FROM 'number'
      OR jsonb_typeof(item->'label') IS DISTINCT FROM 'string' OR length(btrim(item->>'label')) = 0 THEN RETURN false; END IF;
    current_value := (item->>'value')::numeric;
    IF current_value < 0 OR current_value > 1000000 OR current_value <> round(current_value, 4) THEN RETURN false; END IF;
    IF previous IS NOT NULL THEN
      difference := sign(current_value - previous);
      IF difference = 0 OR (direction <> 0 AND difference <> direction) THEN RETURN false; END IF;
      direction := difference;
    END IF;
    highest := greatest(highest, current_value);
    has_zero := has_zero OR current_value = 0;
    previous := current_value;
  END LOOP;
  RETURN has_zero AND max_points = highest;
END;
$$;
COMMIT;
