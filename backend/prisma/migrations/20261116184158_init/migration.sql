-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'dispatcher');

-- CreateEnum
CREATE TYPE "DriverType" AS ENUM ('company', 'owner');

-- CreateEnum
CREATE TYPE "LoadStatus" AS ENUM ('available', 'pickedup', 'delivered');

-- CreateEnum
CREATE TYPE "Theme" AS ENUM ('dark', 'light');

-- CreateEnum
CREATE TYPE "NoticeKind" AS ENUM ('password_changed', 'email_changed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'dispatcher',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "avatar_url" TEXT,
    "full_pct" DECIMAL(5,2),
    "partial_pct" DECIMAL(5,2),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "full_pct" DECIMAL(5,2) NOT NULL DEFAULT 2,
    "partial_pct" DECIMAL(5,2) NOT NULL DEFAULT 3,
    "dispatcher_name" TEXT NOT NULL DEFAULT '',
    "avatar_url" TEXT,
    "theme" "Theme" NOT NULL DEFAULT 'dark',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "truck_number" TEXT NOT NULL,
    "type" "DriverType" NOT NULL DEFAULT 'company',
    "dispatcher_id" UUID,
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loads" (
    "id" UUID NOT NULL,
    "load_number" TEXT NOT NULL,
    "is_partial" BOOLEAN NOT NULL DEFAULT false,
    "parent_load_number" TEXT,
    "driver_id" UUID,
    "from_city" TEXT,
    "to_city" TEXT,
    "status" "LoadStatus" NOT NULL DEFAULT 'available',
    "pickup_date" DATE,
    "delivery_date" DATE,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "assigned_to" UUID,
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load_history" (
    "id" BIGSERIAL NOT NULL,
    "load_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" UUID,
    "old_row" JSONB,
    "new_row" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "load_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_notes" (
    "id" UUID NOT NULL,
    "note_date" DATE NOT NULL,
    "note_text" TEXT NOT NULL,
    "created_by" UUID,
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_cities" (
    "id" UUID NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT NOT NULL DEFAULT '',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_log" (
    "id" UUID NOT NULL,
    "action_text" TEXT NOT NULL,
    "user_email" TEXT NOT NULL,
    "user_id" UUID,
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_notices" (
    "id" UUID NOT NULL,
    "kind" "NoticeKind" NOT NULL,
    "user_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "old_email" TEXT,
    "new_email" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_is_active_idx" ON "users"("role", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "drivers_dispatcher_id_idx" ON "drivers"("dispatcher_id");

-- CreateIndex
CREATE INDEX "drivers_created_at_idx" ON "drivers"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "loads_load_number_key" ON "loads"("load_number");

-- CreateIndex
CREATE INDEX "loads_assigned_to_idx" ON "loads"("assigned_to");

-- CreateIndex
CREATE INDEX "loads_driver_id_idx" ON "loads"("driver_id");

-- CreateIndex
CREATE INDEX "loads_status_idx" ON "loads"("status");

-- CreateIndex
CREATE INDEX "loads_pickup_date_idx" ON "loads"("pickup_date");

-- CreateIndex
CREATE INDEX "loads_created_at_idx" ON "loads"("created_at");

-- CreateIndex
CREATE INDEX "loads_parent_load_number_idx" ON "loads"("parent_load_number");

-- CreateIndex
CREATE INDEX "load_history_load_id_created_at_idx" ON "load_history"("load_id", "created_at");

-- CreateIndex
CREATE INDEX "calendar_notes_note_date_idx" ON "calendar_notes"("note_date");

-- CreateIndex
CREATE UNIQUE INDEX "custom_cities_city_state_zip_key" ON "custom_cities"("city", "state", "zip");

-- CreateIndex
CREATE INDEX "activity_log_user_id_created_at_idx" ON "activity_log"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_log_created_at_idx" ON "activity_log"("created_at");

-- CreateIndex
CREATE INDEX "admin_notices_created_at_idx" ON "admin_notices"("created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_dispatcher_id_fkey" FOREIGN KEY ("dispatcher_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loads" ADD CONSTRAINT "loads_parent_load_number_fkey" FOREIGN KEY ("parent_load_number") REFERENCES "loads"("load_number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loads" ADD CONSTRAINT "loads_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loads" ADD CONSTRAINT "loads_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_history" ADD CONSTRAINT "load_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_notes" ADD CONSTRAINT "calendar_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_cities" ADD CONSTRAINT "custom_cities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_notices" ADD CONSTRAINT "admin_notices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Constraints Prisma cannot express
-- ---------------------------------------------------------------------------
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email") AND "email" <> ''),
  ADD CONSTRAINT "users_full_name_not_blank" CHECK (btrim("full_name") <> ''),
  ADD CONSTRAINT "users_full_pct_range" CHECK ("full_pct" IS NULL OR "full_pct" BETWEEN 0 AND 100),
  ADD CONSTRAINT "users_partial_pct_range" CHECK ("partial_pct" IS NULL OR "partial_pct" BETWEEN 0 AND 100),
  ADD CONSTRAINT "users_failed_login_count_nonneg" CHECK ("failed_login_count" >= 0);

ALTER TABLE "settings"
  ADD CONSTRAINT "settings_single_row" CHECK ("id" = 1),
  ADD CONSTRAINT "settings_full_pct_range" CHECK ("full_pct" BETWEEN 0 AND 100),
  ADD CONSTRAINT "settings_partial_pct_range" CHECK ("partial_pct" BETWEEN 0 AND 100);

ALTER TABLE "drivers"
  ADD CONSTRAINT "drivers_names_not_blank" CHECK (btrim("first_name") <> '' AND btrim("last_name") <> '');

ALTER TABLE "loads"
  ADD CONSTRAINT "loads_load_number_not_blank" CHECK (btrim("load_number") <> ''),
  ADD CONSTRAINT "loads_total_nonneg" CHECK ("total" >= 0),
  ADD CONSTRAINT "loads_dates_order" CHECK ("delivery_date" IS NULL OR "pickup_date" IS NULL OR "delivery_date" >= "pickup_date"),
  ADD CONSTRAINT "loads_partial_has_parent" CHECK (("is_partial" AND "parent_load_number" IS NOT NULL) OR (NOT "is_partial" AND "parent_load_number" IS NULL)),
  ADD CONSTRAINT "loads_not_own_parent" CHECK ("parent_load_number" IS NULL OR "parent_load_number" <> "load_number");

ALTER TABLE "calendar_notes"
  ADD CONSTRAINT "calendar_notes_text_not_blank" CHECK (btrim("note_text") <> '');

ALTER TABLE "load_history"
  ADD CONSTRAINT "load_history_action" CHECK ("action" IN ('INSERT', 'UPDATE', 'DELETE'));

-- The single settings row always exists.
INSERT INTO "settings" ("id", "full_pct", "partial_pct", "dispatcher_name", "theme", "updated_at")
VALUES (1, 2, 3, '', 'dark', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
