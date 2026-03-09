-- Rollback:
--   ALTER TABLE "plugins" DROP COLUMN IF EXISTS "package_path";

ALTER TABLE "plugins" ADD COLUMN "package_path" text;
