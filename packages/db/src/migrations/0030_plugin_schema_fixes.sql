-- Migration 0030: Fix plugin schema type mismatches
--
-- 1. plugin_logs.id: serial → uuid (consistent with all other plugin tables)
-- 2. plugin_entities.scope_id: uuid → text (consistent with plugin_state.scope_id)
--
-- Rollback:
--   ALTER TABLE "plugin_logs" DROP COLUMN "id";
--   ALTER TABLE "plugin_logs" ADD COLUMN "id" serial PRIMARY KEY;
--   ALTER TABLE "plugin_entities" ALTER COLUMN "scope_id" TYPE uuid USING "scope_id"::uuid;

-- 1. Convert plugin_logs.id from serial to uuid
-- Drop the existing serial primary key and replace with uuid
ALTER TABLE "plugin_logs" ADD COLUMN "new_id" uuid DEFAULT gen_random_uuid() NOT NULL;

-- Backfill existing rows (assign UUIDs to existing serial IDs)
UPDATE "plugin_logs" SET "new_id" = gen_random_uuid() WHERE "new_id" IS NULL;

-- Drop the old primary key constraint and column
ALTER TABLE "plugin_logs" DROP CONSTRAINT "plugin_logs_pkey";
ALTER TABLE "plugin_logs" DROP COLUMN "id";

-- Rename new_id to id and set as primary key
ALTER TABLE "plugin_logs" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "plugin_logs" ADD PRIMARY KEY ("id");

-- 2. Convert plugin_entities.scope_id from uuid to text
-- This makes it consistent with plugin_state.scope_id which is already text
ALTER TABLE "plugin_entities" ALTER COLUMN "scope_id" TYPE text USING "scope_id"::text;
