-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('RU', 'KZ', 'EN');

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('DRAFT', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "externalId" VARCHAR(200) NOT NULL,
    "language" "Language" NOT NULL,
    "channel" VARCHAR(50) NOT NULL,
    "audioUrl" TEXT,
    "transcript" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checklist" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Checklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistCriterion" (
    "id" UUID NOT NULL,
    "checklistId" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "maxPoints" DECIMAL(12,4) NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ChecklistCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "checklistId" UUID NOT NULL,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriterionResult" (
    "id" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "checklistId" UUID NOT NULL,
    "criterionId" UUID NOT NULL,
    "points" DECIMAL(12,4),
    "isNa" BOOLEAN NOT NULL DEFAULT false,
    "explanation" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CriterionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appeal" (
    "id" UUID NOT NULL,
    "criterionResultId" UUID NOT NULL,
    "comment" TEXT NOT NULL,
    "status" "AppealStatus" NOT NULL DEFAULT 'PENDING',
    "reviewer" VARCHAR(200),
    "decisionReason" TEXT,
    "revisedPoints" DECIMAL(12,4),
    "revisedIsNa" BOOLEAN,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Appeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_externalId_key" ON "Conversation"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Checklist_key_version_key" ON "Checklist"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistCriterion_checklistId_key_key" ON "ChecklistCriterion"("checklistId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistCriterion_id_checklistId_key" ON "ChecklistCriterion"("id", "checklistId");

-- CreateIndex
CREATE INDEX "Evaluation_checklistId_idx" ON "Evaluation"("checklistId");

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_conversationId_checklistId_key" ON "Evaluation"("conversationId", "checklistId");

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_id_checklistId_key" ON "Evaluation"("id", "checklistId");

-- CreateIndex
CREATE INDEX "CriterionResult_criterionId_checklistId_idx" ON "CriterionResult"("criterionId", "checklistId");

-- CreateIndex
CREATE UNIQUE INDEX "CriterionResult_evaluationId_criterionId_key" ON "CriterionResult"("evaluationId", "criterionId");

-- CreateIndex
CREATE INDEX "Appeal_criterionResultId_decidedAt_idx" ON "Appeal"("criterionResultId", "decidedAt");

-- AddForeignKey
ALTER TABLE "ChecklistCriterion" ADD CONSTRAINT "ChecklistCriterion_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "Checklist"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "Checklist"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CriterionResult" ADD CONSTRAINT "CriterionResult_evaluationId_checklistId_fkey" FOREIGN KEY ("evaluationId", "checklistId") REFERENCES "Evaluation"("id", "checklistId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CriterionResult" ADD CONSTRAINT "CriterionResult_criterionId_checklistId_fkey" FOREIGN KEY ("criterionId", "checklistId") REFERENCES "ChecklistCriterion"("id", "checklistId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_criterionResultId_fkey" FOREIGN KEY ("criterionResultId") REFERENCES "CriterionResult"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
