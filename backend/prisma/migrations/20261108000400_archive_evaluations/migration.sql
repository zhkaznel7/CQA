BEGIN;
ALTER TABLE "Evaluation" ADD COLUMN "deletedAt" TIMESTAMPTZ(3);
ALTER TABLE "Evaluation" ADD CONSTRAINT evaluation_archive_completed
  CHECK ("deletedAt" IS NULL OR status = 'COMPLETED');
CREATE UNIQUE INDEX "Evaluation_active_pair_key" ON "Evaluation" ("conversationId", "checklistId")
  WHERE "deletedAt" IS NULL;
DROP INDEX "Evaluation_conversationId_checklistId_key";

-- Keep the original insert, completion and history checks. Allow exactly one
-- visibility change on a completed snapshot without modifying its contents.
CREATE OR REPLACE FUNCTION cqa_guard_evaluation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM "Conversation" WHERE id = NEW."conversationId" FOR UPDATE;
    PERFORM 1 FROM "Checklist" WHERE id = NEW."checklistId" FOR UPDATE;
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Create an evaluation as DRAFT before adding results' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF OLD.status = 'COMPLETED' THEN
      IF TG_OP = 'UPDATE' AND OLD."deletedAt" IS NULL AND NEW."deletedAt" IS NOT NULL
          AND (to_jsonb(NEW) - 'deletedAt') = (to_jsonb(OLD) - 'deletedAt') THEN
        RETURN NEW;
      END IF;
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
COMMIT;
