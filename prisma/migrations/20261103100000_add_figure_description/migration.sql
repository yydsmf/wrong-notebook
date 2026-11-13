-- Add a separate field for visual descriptions so the original transcription stays verbatim.
ALTER TABLE "ErrorItem" ADD COLUMN "figureDescription" TEXT;
