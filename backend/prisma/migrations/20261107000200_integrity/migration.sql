-- Prisma does not model CHECK constraints, triggers or these read-only views.
BEGIN;

ALTER TABLE "Conversation" ADD CONSTRAINT "conversation_fields_check"
  CHECK (length(btrim("externalId")) > 0 AND length(btrim(channel)) > 0
    AND jsonb_typeof(transcript) = 'array');
ALTER TABLE "Checklist" ADD CONSTRAINT "checklist_fields_check"
  CHECK (version > 0 AND length(btrim(key)) > 0 AND length(btrim(name)) > 0
    AND jsonb_typeof(config) = 'object');
ALTER TABLE "ChecklistCriterion" ADD CONSTRAINT "criterion_fields_check"
  CHECK ("maxPoints" > 0 AND length(btrim(key)) > 0 AND length(btrim(name)) > 0
    AND jsonb_typeof(config) = 'object');
ALTER TABLE "Evaluation" ADD CONSTRAINT "evaluation_completion_check"
  CHECK ((status = 'DRAFT' AND "completedAt" IS NULL)
    OR (status = 'COMPLETED' AND "completedAt" IS NOT NULL));
ALTER TABLE "CriterionResult" ADD CONSTRAINT "result_points_check"
  CHECK (("isNa" AND points IS NULL) OR (NOT "isNa" AND points IS NOT NULL AND points >= 0));
ALTER TABLE "CriterionResult" ADD CONSTRAINT "result_explanation_check"
  CHECK (length(btrim(explanation)) > 0 AND jsonb_typeof(evidence) = 'array');
ALTER TABLE "Appeal" ADD CONSTRAINT "appeal_state_check" CHECK (
  length(btrim(comment)) > 0 AND (
    (status = 'PENDING' AND reviewer IS NULL AND "decisionReason" IS NULL
      AND "decidedAt" IS NULL AND "revisedPoints" IS NULL AND "revisedIsNa" IS NULL)
    OR
    (status IN ('ACCEPTED', 'REJECTED') AND reviewer IS NOT NULL AND length(btrim(reviewer)) > 0
      AND "decisionReason" IS NOT NULL AND length(btrim("decisionReason")) > 0
      AND "decidedAt" IS NOT NULL AND "decidedAt" >= "createdAt"
      AND ((status = 'REJECTED' AND "revisedPoints" IS NULL AND "revisedIsNa" IS NULL)
        OR (status = 'ACCEPTED' AND "revisedIsNa" IS NOT NULL AND
          (("revisedIsNa" AND "revisedPoints" IS NULL)
            OR (NOT "revisedIsNa" AND "revisedPoints" IS NOT NULL AND "revisedPoints" >= 0)))))
  ));
CREATE UNIQUE INDEX "one_pending_appeal_per_result" ON "Appeal" ("criterionResultId")
  WHERE status = 'PENDING';

CREATE FUNCTION cqa_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable; create a new version or appeal', TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER checklist_immutable BEFORE UPDATE OR DELETE ON "Checklist"
  FOR EACH ROW EXECUTE FUNCTION cqa_immutable();
CREATE TRIGGER checklist_criterion_immutable BEFORE UPDATE OR DELETE ON "ChecklistCriterion"
  FOR EACH ROW EXECUTE FUNCTION cqa_immutable();

CREATE FUNCTION cqa_lock_checklist_criteria() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "Checklist" WHERE id = NEW."checklistId" FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "Evaluation" WHERE "checklistId" = NEW."checklistId") THEN
    RAISE EXCEPTION 'Cannot add criteria to a checklist already used by an evaluation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER checklist_criterion_insert BEFORE INSERT ON "ChecklistCriterion"
  FOR EACH ROW EXECUTE FUNCTION cqa_lock_checklist_criteria();

CREATE FUNCTION cqa_guard_conversation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Evaluation" WHERE "conversationId" = OLD.id) THEN
    RAISE EXCEPTION 'Evaluated conversation is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER conversation_history BEFORE UPDATE OR DELETE ON "Conversation"
  FOR EACH ROW EXECUTE FUNCTION cqa_guard_conversation();

CREATE FUNCTION cqa_guard_evaluation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM "Conversation" WHERE id = NEW."conversationId" FOR UPDATE;
    PERFORM 1 FROM "Checklist" WHERE id = NEW."checklistId" FOR UPDATE;
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Create an evaluation as DRAFT before adding results' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF OLD.status = 'COMPLETED' THEN
      RAISE EXCEPTION 'Completed evaluation is immutable' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF (NEW.id, NEW."conversationId", NEW."checklistId", NEW."createdAt")
      IS DISTINCT FROM (OLD.id, OLD."conversationId", OLD."checklistId", OLD."createdAt") THEN
      RAISE EXCEPTION 'Evaluation identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'COMPLETED' AND (
      NOT EXISTS (SELECT 1 FROM "ChecklistCriterion" WHERE "checklistId" = NEW."checklistId")
      OR (SELECT count(*) FROM "CriterionResult" WHERE "evaluationId" = NEW.id)
        <> (SELECT count(*) FROM "ChecklistCriterion" WHERE "checklistId" = NEW."checklistId")
    ) THEN
      RAISE EXCEPTION 'Completion requires a result for every checklist criterion' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER evaluation_history BEFORE INSERT OR UPDATE OR DELETE ON "Evaluation"
  FOR EACH ROW EXECUTE FUNCTION cqa_guard_evaluation();

CREATE FUNCTION cqa_guard_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id uuid;
  evaluation_status "EvaluationStatus";
  turn_count integer;
  max_points numeric;
  item jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN target_id := OLD."evaluationId";
  ELSE target_id := NEW."evaluationId"; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW."evaluationId", NEW."checklistId", NEW."criterionId", NEW."createdAt")
    IS DISTINCT FROM (OLD.id, OLD."evaluationId", OLD."checklistId", OLD."criterionId", OLD."createdAt") THEN
    RAISE EXCEPTION 'Result identity is immutable' USING ERRCODE = '23514';
  END IF;
  SELECT status INTO evaluation_status FROM "Evaluation" WHERE id = target_id FOR UPDATE;
  IF evaluation_status = 'COMPLETED' THEN
    RAISE EXCEPTION 'Original result is immutable; use an appeal' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT "maxPoints" INTO max_points FROM "ChecklistCriterion" WHERE id = NEW."criterionId";
  IF NEW.points > max_points THEN
    RAISE EXCEPTION 'Points exceed criterion maximum' USING ERRCODE = '23514';
  END IF;
  SELECT jsonb_array_length(c.transcript) INTO turn_count
    FROM "Conversation" c JOIN "Evaluation" e ON e."conversationId" = c.id WHERE e.id = target_id;
  IF jsonb_typeof(NEW.evidence) <> 'array' THEN
    RAISE EXCEPTION 'Evidence must be an array' USING ERRCODE = '23514';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.evidence) LOOP
    IF jsonb_typeof(item) <> 'object' OR NOT (item ? 'turnIndex')
      OR jsonb_typeof(item->'turnIndex') <> 'number'
      OR (item->>'turnIndex') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Evidence needs an integer turnIndex starting at zero' USING ERRCODE = '23514';
    END IF;
    IF (item->>'turnIndex')::numeric >= turn_count THEN
      RAISE EXCEPTION 'Evidence references a missing transcript turn' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER result_history BEFORE INSERT OR UPDATE OR DELETE ON "CriterionResult"
  FOR EACH ROW EXECUTE FUNCTION cqa_guard_result();

CREATE FUNCTION cqa_guard_appeal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  evaluation_status "EvaluationStatus";
  max_points numeric;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF OLD.status <> 'PENDING' OR TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Appeal history cannot be overwritten or deleted' USING ERRCODE = '23514';
    END IF;
    IF (NEW.id, NEW."criterionResultId", NEW.comment, NEW."createdAt")
      IS DISTINCT FROM (OLD.id, OLD."criterionResultId", OLD.comment, OLD."createdAt") THEN
      RAISE EXCEPTION 'Appeal identity and original comment are immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  -- Serialize decisions on the same result so latest accepted decision is deterministic.
  PERFORM 1 FROM "CriterionResult" WHERE id = NEW."criterionResultId" FOR UPDATE;
  SELECT e.status, c."maxPoints" INTO evaluation_status, max_points
    FROM "CriterionResult" r JOIN "Evaluation" e ON e.id = r."evaluationId"
    JOIN "ChecklistCriterion" c ON c.id = r."criterionId" WHERE r.id = NEW."criterionResultId";
  IF evaluation_status IS DISTINCT FROM 'COMPLETED'::"EvaluationStatus" THEN
    RAISE EXCEPTION 'Appeals require a completed evaluation' USING ERRCODE = '23514';
  END IF;
  IF NEW."revisedPoints" > max_points THEN
    RAISE EXCEPTION 'Revised points exceed criterion maximum' USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> 'PENDING' THEN
    SELECT greatest(clock_timestamp(), coalesce(max("decidedAt") + interval '1 millisecond', clock_timestamp()))
      INTO NEW."decidedAt" FROM "Appeal" WHERE "criterionResultId" = NEW."criterionResultId";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER appeal_history BEFORE INSERT OR UPDATE OR DELETE ON "Appeal"
  FOR EACH ROW EXECUTE FUNCTION cqa_guard_appeal();

CREATE VIEW "EffectiveCriterionResult" AS
SELECT r.id, r."evaluationId", r."criterionId", r."checklistId",
  r.points AS "originalPoints", r."isNa" AS "originalIsNa",
  CASE WHEN a.id IS NULL THEN r.points ELSE a."revisedPoints" END AS "effectivePoints",
  CASE WHEN a.id IS NULL THEN r."isNa" ELSE a."revisedIsNa" END AS "effectiveIsNa",
  c."maxPoints", a.id AS "acceptedAppealId"
FROM "CriterionResult" r
JOIN "Evaluation" e ON e.id = r."evaluationId" AND e.status = 'COMPLETED'
JOIN "ChecklistCriterion" c ON c.id = r."criterionId"
LEFT JOIN LATERAL (
  SELECT * FROM "Appeal" WHERE "criterionResultId" = r.id AND status = 'ACCEPTED'
  ORDER BY "decidedAt" DESC, id DESC LIMIT 1
) a ON true;

-- Raw point sums, not a normalized/weighted scoring algorithm.
CREATE VIEW "EvaluationTotals" AS
SELECT "evaluationId",
  coalesce(sum("originalPoints"), 0) AS "originalPoints",
  coalesce(sum("maxPoints") FILTER (WHERE NOT "originalIsNa"), 0) AS "originalMaxPoints",
  coalesce(sum("effectivePoints"), 0) AS "effectivePoints",
  coalesce(sum("maxPoints") FILTER (WHERE NOT "effectiveIsNa"), 0) AS "effectiveMaxPoints"
FROM "EffectiveCriterionResult" GROUP BY "evaluationId";

COMMIT;
