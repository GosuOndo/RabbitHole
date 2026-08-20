-- AlterTable
ALTER TABLE "RecommendationResult" ADD COLUMN     "diagnostics" JSONB,
ALTER COLUMN "contentScore" DROP NOT NULL,
ALTER COLUMN "collaborativeScore" DROP NOT NULL,
ALTER COLUMN "sessionScore" DROP NOT NULL;

-- AlterTable
ALTER TABLE "RecommendationRun" ADD COLUMN     "diagnostics" JSONB;
