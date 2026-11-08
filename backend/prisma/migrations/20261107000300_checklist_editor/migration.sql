BEGIN;

-- Keep legacy stage-2 JSON configs valid, but validate all editor-managed configs.
CREATE FUNCTION cqa_valid_editor_criterion(cfg jsonb, max_points numeric)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  item jsonb;
  previous numeric := -1;
  current_value numeric;
  weight numeric;
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
    IF current_value < 0 OR current_value > 1000000 OR current_value <> round(current_value, 4)
      OR current_value <= previous OR (previous = -1 AND current_value <> 0) THEN RETURN false; END IF;
    previous := current_value;
  END LOOP;
  RETURN max_points = previous;
END;
$$;

ALTER TABLE "ChecklistCriterion" DROP CONSTRAINT "criterion_fields_check";
ALTER TABLE "ChecklistCriterion" ADD CONSTRAINT "criterion_fields_check" CHECK (
  length(btrim(key)) > 0 AND length(btrim(name)) > 0 AND jsonb_typeof(config) = 'object'
  AND (("maxPoints" > 0) OR ("maxPoints" = 0 AND config->'schemaVersion' = '1'::jsonb AND config->>'type' = 'flag'))
  AND cqa_valid_editor_criterion(config, "maxPoints")
);

CREATE FUNCTION cqa_validate_editor_checklist() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
  cfg jsonb;
  section jsonb;
  section_keys text[] := ARRAY[]::text[];
  total_weight numeric;
  criterion_count integer;
BEGIN
  IF TG_TABLE_NAME = 'Checklist' THEN target := NEW.id; ELSE target := NEW."checklistId"; END IF;
  SELECT config INTO cfg FROM "Checklist" WHERE id = target;
  IF NOT (cfg ? 'schemaVersion') THEN
    IF EXISTS (SELECT 1 FROM "ChecklistCriterion" WHERE "checklistId" = target AND config ? 'schemaVersion') THEN
      RAISE EXCEPTION 'Editor criteria require an editor checklist' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END IF;
  IF cfg->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(cfg->'sections') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid checklist editor config' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(cfg->'sections') < 1 OR jsonb_array_length(cfg->'sections') > 30 THEN
    RAISE EXCEPTION 'Checklist sections must not be empty' USING ERRCODE = '23514';
  END IF;
  FOR section IN SELECT value FROM jsonb_array_elements(cfg->'sections') LOOP
    IF jsonb_typeof(section->'key') IS DISTINCT FROM 'string' OR length(btrim(section->>'key')) = 0
      OR jsonb_typeof(section->'name') IS DISTINCT FROM 'string' OR length(btrim(section->>'name')) = 0
      OR section->>'key' = ANY(section_keys) THEN
      RAISE EXCEPTION 'Invalid or duplicate checklist section' USING ERRCODE = '23514';
    END IF;
    section_keys := array_append(section_keys, section->>'key');
  END LOOP;
  SELECT count(*), sum((config->>'weight')::numeric) INTO criterion_count, total_weight
    FROM "ChecklistCriterion" WHERE "checklistId" = target;
  IF criterion_count < 1 OR criterion_count > 100 OR total_weight IS DISTINCT FROM 100::numeric
    OR EXISTS (SELECT 1 FROM "ChecklistCriterion" WHERE "checklistId" = target
      AND (config->'schemaVersion' IS DISTINCT FROM '1'::jsonb
        OR NOT coalesce(config->>'sectionKey' = ANY(section_keys), false)))
    OR (SELECT count(DISTINCT config->>'position') FROM "ChecklistCriterion" WHERE "checklistId" = target) <> criterion_count
    OR (SELECT max((config->>'position')::numeric) FROM "ChecklistCriterion" WHERE "checklistId" = target) <> criterion_count - 1
  THEN
    RAISE EXCEPTION 'Invalid checklist criteria, positions, sections or weight total (must be 100)' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

-- Deferred checks allow parent and children to be created atomically in one transaction.
CREATE CONSTRAINT TRIGGER checklist_editor_integrity AFTER INSERT ON "Checklist"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cqa_validate_editor_checklist();
CREATE CONSTRAINT TRIGGER checklist_criterion_editor_integrity AFTER INSERT ON "ChecklistCriterion"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cqa_validate_editor_checklist();

CREATE INDEX "Conversation_language_channel_idx" ON "Conversation" (language, channel);
CREATE INDEX "Conversation_createdAt_id_idx" ON "Conversation" ("createdAt", id);
COMMIT;
