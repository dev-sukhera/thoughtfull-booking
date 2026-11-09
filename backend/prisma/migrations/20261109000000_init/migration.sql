CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MEMBER', 'PROFESSIONAL');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('BOOKED', 'CANCELLED', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('BEFORE_24H', 'BEFORE_1H');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'SENT', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "timezone" TEXT NOT NULL,
    "title" TEXT,
    "bio" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_availability" (
    "id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,

    CONSTRAINT "weekly_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_dates" (
    "id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "blocked_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'BOOKED',
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_role" "Role",
    "rescheduled_from_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "remind_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reminder_id" UUID,
    "booking_id" UUID,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_availability_professional_id_weekday_key" ON "weekly_availability"("professional_id", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "blocked_dates_professional_id_date_key" ON "blocked_dates"("professional_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_rescheduled_from_id_key" ON "bookings"("rescheduled_from_id");

-- CreateIndex
CREATE INDEX "bookings_professional_id_starts_at_idx" ON "bookings"("professional_id", "starts_at");

-- CreateIndex
CREATE INDEX "bookings_member_id_starts_at_idx" ON "bookings"("member_id", "starts_at");

-- CreateIndex
CREATE INDEX "reminders_status_remind_at_idx" ON "reminders"("status", "remind_at");

-- CreateIndex
CREATE UNIQUE INDEX "reminders_booking_id_user_id_kind_key" ON "reminders"("booking_id", "user_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_reminder_id_key" ON "notifications"("reminder_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_availability" ADD CONSTRAINT "weekly_availability_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_dates" ADD CONSTRAINT "blocked_dates_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_rescheduled_from_id_fkey" FOREIGN KEY ("rescheduled_from_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "reminders"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: double-booking protection that Prisma cannot model.
-- An exclusion constraint rejects any two BOOKED rows whose [starts_at, ends_at)
-- ranges overlap for the same professional (or the same member). Postgres checks
-- this atomically at insert/update time, so it also holds under concurrent requests.
-- ---------------------------------------------------------------------------
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_valid_range" CHECK ("ends_at" > "starts_at");

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_professional_overlap"
  EXCLUDE USING gist ("professional_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&)
  WHERE ("status" = 'BOOKED');

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_member_overlap"
  EXCLUDE USING gist ("member_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&)
  WHERE ("status" = 'BOOKED');

ALTER TABLE "weekly_availability" ADD CONSTRAINT "weekly_availability_valid"
  CHECK ("weekday" BETWEEN 1 AND 7 AND "start_minute" >= 0 AND "end_minute" <= 1440 AND "start_minute" < "end_minute");
