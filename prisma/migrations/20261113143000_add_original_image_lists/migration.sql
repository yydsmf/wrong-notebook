-- 保留旧单图字段和所有已有记录，多图字段只用于新增数据。
ALTER TABLE "ErrorItem" ADD COLUMN "originalImageUrls" TEXT;
ALTER TABLE "PracticeRecord" ADD COLUMN "originalImageUrls" TEXT;
