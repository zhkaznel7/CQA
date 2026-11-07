-- Existing IDs, transcripts and evaluation relations are unchanged. Unknown provenance
-- stays explicit; no existing row is silently assigned to DEV or a control group.
BEGIN;
ALTER TABLE "Conversation" ADD COLUMN "groupId" VARCHAR(200) NOT NULL DEFAULT '__legacy__';
CREATE UNIQUE INDEX "Conversation_groupId_externalId_key" ON "Conversation"("groupId", "externalId");
DROP INDEX "Conversation_externalId_key";
CREATE INDEX "Conversation_groupId_createdAt_id_idx" ON "Conversation"("groupId", "createdAt", "id");
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_group_id_valid"
  CHECK ("groupId" = '__legacy__' OR "groupId" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$');

-- Moving a record into another dataset would invalidate its provenance, even before
-- evaluation. Reimport into the correct group instead of editing an existing row.
CREATE FUNCTION cqa_guard_conversation_group() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."groupId" IS DISTINCT FROM OLD."groupId" THEN
    RAISE EXCEPTION 'Conversation group is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER conversation_group_immutable BEFORE UPDATE ON "Conversation"
  FOR EACH ROW EXECUTE FUNCTION cqa_guard_conversation_group();
COMMIT;
