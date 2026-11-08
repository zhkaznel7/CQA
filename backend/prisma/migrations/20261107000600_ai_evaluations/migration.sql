BEGIN;
-- Nullable additions preserve every pre-existing result and its original raw-point meaning.
ALTER TABLE "Evaluation"
  ADD COLUMN provider varchar(20), ADD COLUMN transport varchar(20),
  ADD COLUMN score jsonb, ADD COLUMN "aiResponse" jsonb;
ALTER TABLE "CriterionResult"
  ADD COLUMN answer jsonb, ADD COLUMN "checkedRange" jsonb, ADD COLUMN "naReason" text;

ALTER TABLE "Evaluation" ADD CONSTRAINT evaluation_ai_snapshot_check CHECK (
  (provider IS NULL AND transport IS NULL AND score IS NULL AND "aiResponse" IS NULL)
  OR (provider IS NOT NULL AND provider IN ('mock', 'ai') AND transport IS NOT NULL AND transport IN ('local', 'http')
    AND score IS NOT NULL AND jsonb_typeof(score) = 'object'
    AND "aiResponse" IS NOT NULL AND jsonb_typeof("aiResponse") = 'object'
    AND NOT (provider = 'ai' AND transport = 'local'))
);
ALTER TABLE "CriterionResult" ADD CONSTRAINT result_ai_details_check CHECK (
  (answer IS NULL OR (jsonb_typeof(answer) IN ('boolean', 'number', 'null')
    AND (("isNa" AND answer = 'null'::jsonb AND "naReason" IS NOT NULL AND length(btrim("naReason")) > 0)
      OR (NOT "isNa" AND jsonb_typeof(answer) IN ('boolean', 'number') AND "naReason" IS NULL))))
  AND ("checkedRange" IS NULL OR (jsonb_typeof("checkedRange") = 'object'
    AND coalesce(jsonb_typeof("checkedRange"->'start') = 'number' AND jsonb_typeof("checkedRange"->'end') = 'number', false)))
);

CREATE TABLE "ApplicabilityConfirmation" (
  id uuid NOT NULL PRIMARY KEY,
  "conversationId" uuid NOT NULL,
  "checklistId" uuid NOT NULL,
  "criterionKey" varchar(100) NOT NULL,
  rule varchar(50) NOT NULL,
  "confirmedBy" varchar(200) NOT NULL,
  reference text NOT NULL,
  "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT applicability_confirmation_fields_check CHECK (
    rule IN ('verified_condition', 'recording_start_missing')
    AND length(btrim("confirmedBy")) > 0 AND length(btrim(reference)) > 0),
  CONSTRAINT "ApplicabilityConfirmation_conversationId_fkey" FOREIGN KEY ("conversationId")
    REFERENCES "Conversation"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ApplicabilityConfirmation_checklistId_criterionKey_fkey" FOREIGN KEY ("checklistId", "criterionKey")
    REFERENCES "ChecklistCriterion"("checklistId", key) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "ApplicabilityConfirmation_target_key"
  ON "ApplicabilityConfirmation"("conversationId", "checklistId", "criterionKey");
CREATE INDEX "ApplicabilityConfirmation_checklistId_criterionKey_idx"
  ON "ApplicabilityConfirmation"("checklistId", "criterionKey");
CREATE TRIGGER applicability_confirmation_immutable BEFORE UPDATE OR DELETE ON "ApplicabilityConfirmation"
  FOR EACH ROW EXECUTE FUNCTION cqa_immutable();

CREATE FUNCTION cqa_valid_applicability_rule(cfg jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE rule jsonb; channel jsonb;
BEGIN
  rule := cfg->'applicabilityRule';
  IF rule IS NULL OR rule = 'null'::jsonb THEN RETURN true; END IF;
  IF jsonb_typeof(rule) <> 'object' OR rule->>'kind' IS DISTINCT FROM 'recording_start_missing'
    OR cfg->>'type' IS DISTINCT FROM 'boolean' OR cfg->'allowNa' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(rule->'channels') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(rule->'channels') NOT BETWEEN 1 AND 2 THEN RETURN false; END IF;
  FOR channel IN SELECT value FROM jsonb_array_elements(rule->'channels') LOOP
    IF channel NOT IN ('"voice"'::jsonb, '"call"'::jsonb) THEN RETURN false; END IF;
  END LOOP;
  RETURN (SELECT count(DISTINCT value) FROM jsonb_array_elements(rule->'channels')) = jsonb_array_length(rule->'channels');
END;
$$;
ALTER TABLE "ChecklistCriterion" ADD CONSTRAINT criterion_applicability_rule_check CHECK (cqa_valid_applicability_rule(config));
COMMIT;
