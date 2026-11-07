BEGIN;
-- Additive audit fields: existing Evaluation/AI answers/evidence are never updated.
ALTER TABLE "Appeal"
  ADD COLUMN decision varchar(10), ADD COLUMN "revisedAnswer" jsonb,
  ADD COLUMN "revisedNaReason" text, ADD COLUMN "beforeScore" jsonb, ADD COLUMN "afterScore" jsonb;

ALTER TABLE "Appeal" ADD CONSTRAINT appeal_decision_snapshot_check CHECK (
  (decision IS NULL AND "revisedAnswer" IS NULL AND "revisedNaReason" IS NULL
    AND "beforeScore" IS NULL AND "afterScore" IS NULL)
  OR (decision IS NOT NULL AND decision IN ('CONFIRM', 'CHANGE')
    AND "beforeScore" IS NOT NULL AND jsonb_typeof("beforeScore") = 'object'
    AND "afterScore" IS NOT NULL AND jsonb_typeof("afterScore") = 'object'
    AND ((decision = 'CONFIRM' AND status = 'REJECTED' AND "revisedAnswer" IS NULL AND "revisedNaReason" IS NULL)
      OR (decision = 'CHANGE' AND status = 'ACCEPTED' AND "revisedAnswer" IS NOT NULL
        AND (("revisedIsNa" = true AND "revisedAnswer" = 'null'::jsonb
            AND "revisedNaReason" IS NOT NULL AND length(btrim("revisedNaReason")) > 0)
          OR ("revisedIsNa" = false AND jsonb_typeof("revisedAnswer") IN ('boolean', 'number') AND "revisedNaReason" IS NULL)))))
);
-- Do not reject or rewrite historical long comments; new writes must respect the API limit.
ALTER TABLE "Appeal" ADD CONSTRAINT appeal_comment_length_check CHECK (length(comment) <= 4000) NOT VALID;

CREATE FUNCTION cqa_guard_appeal_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.decision IS NOT NULL AND TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Create a PENDING appeal before recording a decision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER appeal_decision_guard BEFORE INSERT OR UPDATE ON "Appeal"
  FOR EACH ROW EXECUTE FUNCTION cqa_guard_appeal_decision();
-- Existing appeal_history trigger and one_pending_appeal_per_result index remain active.
COMMIT;
