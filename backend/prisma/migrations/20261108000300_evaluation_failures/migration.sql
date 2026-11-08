CREATE TABLE "EvaluationFailure" (
  "conversationId" uuid NOT NULL REFERENCES "Conversation"(id) ON DELETE CASCADE,
  "checklistId" uuid NOT NULL REFERENCES "Checklist"(id) ON DELETE CASCADE,
  message text NOT NULL,
  PRIMARY KEY ("conversationId", "checklistId")
);
