BEGIN;
-- SQL CHECK treats NULL as success: explicitly reject missing flag metadata at zero.
ALTER TABLE "ChecklistCriterion" DROP CONSTRAINT "criterion_fields_check";
ALTER TABLE "ChecklistCriterion" ADD CONSTRAINT "criterion_fields_check" CHECK (
  length(btrim(key)) > 0 AND length(btrim(name)) > 0 AND jsonb_typeof(config) = 'object'
  AND ("maxPoints" > 0 OR ("maxPoints" = 0
    AND coalesce(config->'schemaVersion' = '1'::jsonb AND config->>'type' = 'flag', false)))
  AND cqa_valid_editor_criterion(config, "maxPoints")
);
COMMIT;
