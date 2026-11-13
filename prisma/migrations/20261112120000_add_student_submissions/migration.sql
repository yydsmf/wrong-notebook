CREATE TABLE "StudentSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "examPaperId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'grading',
    "totalCount" INTEGER NOT NULL,
    "gradedCount" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "StudentSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "StudentAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "errorItemId" TEXT,
    "examQuestionId" TEXT,
    "questionText" TEXT NOT NULL,
    "answerText" TEXT NOT NULL,
    "analysis" TEXT,
    "originalImageUrl" TEXT,
    "figureSvg" TEXT,
    "imageFragments" TEXT,
    "userAnswer" TEXT,
    "userAnswerImageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "isCorrect" BOOLEAN,
    "reason" TEXT,
    "mistakeAnalysis" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudentAnswer_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "StudentSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudentAnswer_errorItemId_fkey" FOREIGN KEY ("errorItemId") REFERENCES "ErrorItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StudentAnswer_examQuestionId_fkey" FOREIGN KEY ("examQuestionId") REFERENCES "ExamQuestion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "StudentSubmission_userId_kind_createdAt_idx" ON "StudentSubmission"("userId", "kind", "createdAt");
CREATE INDEX "StudentSubmission_userId_examPaperId_createdAt_idx" ON "StudentSubmission"("userId", "examPaperId", "createdAt");
CREATE INDEX "StudentAnswer_submissionId_status_idx" ON "StudentAnswer"("submissionId", "status");
CREATE INDEX "StudentAnswer_errorItemId_submissionId_idx" ON "StudentAnswer"("errorItemId", "submissionId");
CREATE INDEX "StudentAnswer_examQuestionId_submissionId_idx" ON "StudentAnswer"("examQuestionId", "submissionId");
