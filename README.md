# ThoughtFull: Session Booking with Reminders

A small, working version of a booking flow. A member finds a professional, sees their free slots for the next 4 weeks in the member's own timezone, books a 50-minute session, and both people get in-app reminders 24 hours and 1 hour before it starts.

- **Backend:** Node 20, TypeScript, Express 5, Prisma, PostgreSQL 16
- **Frontend:** React 18, Vite, React Router, Luxon
- **Tests:** Vitest, with unit tests for the pure logic and integration tests against a real Postgres

Design decisions, trade-offs and production notes are in [DECISIONS.md](DECISIONS.md). AI usage is in [AI_USAGE.md](AI_USAGE.md).

## Quick start

You need **Docker** with Docker Compose v2.

```bash
docker compose up --build
```

Then open **http://localhost:8080**.

On first start the API applies migrations and seeds fictional demo users. They all use the password `Password123!`:

| Role         | Email                     | Timezone          |
|--------------|---------------------------|-------------------|
| Member       | `alex@example.com`        | Australia/Sydney  |
| Member       | `jordan@example.com`      | Europe/Berlin     |
| Professional | `mei.lin@example.com`     | Asia/Singapore    |
| Professional | `sam.okafor@example.com`  | Europe/London     |
| Professional | `priya.raman@example.com` | America/New_York  |

You can also sign up new members and professionals from the UI.

| Service  | URL                           |
|----------|-------------------------------|
| Web app  | http://localhost:8080         |
| API      | http://localhost:4000/api     |
| Postgres | `localhost:5433` (booking / booking) |

To start again from scratch, run `docker compose down -v`.

## Running the tests

One command runs everything (unit + integration) against a throwaway Postgres held in memory:

```bash
docker compose run --rm --build test
```

To run the tests without Docker for the app itself (you still need a Postgres, e.g. `docker compose up -d db`):

```bash
cd backend && npm install
docker compose exec db psql -U booking -c "CREATE DATABASE booking_test"   # once
npm run test:local     # unit + integration, against localhost:5433/booking_test
npm run test:unit      # pure logic only, no database needed
```

As a safety guard, integration tests refuse to run unless the database name contains `test`, because they truncate every table.

**What is covered** (81 tests):

| Area | Where |
|------|-------|
| Slot generation: layout, working-hour edges, 24:00, past slots, 4-week window, busy intervals, blocked dates | `tests/unit/slots.test.ts` |
| Timezones and DST: spring-forward gap, fall-back overlap, local hours fixed across DST, grouping in the member's timezone | `tests/unit/slots.test.ts`, `tests/integration/booking.test.ts` |
| 24-hour rule: exactly 24h, 1 ms inside, after start; professional cancel at any time | `tests/unit/policy-and-reminders.test.ts`, `tests/integration/booking.test.ts` |
| Double-booking: 8 concurrent requests for one slot, same member with two professionals concurrently, partial overlaps | `tests/integration/booking.test.ts` |
| Reschedule: atomic move, failed move keeps the original, two concurrent reschedules never leave two sessions | `tests/integration/booking.test.ts` |
| Reminders: which are created, skipped when already past, cancel/reschedule updates, exactly-once with 6 concurrent workers, catch-up after downtime, expiry | `tests/unit/policy-and-reminders.test.ts`, `tests/integration/reminders.test.ts` |
| Auth and access control: cookie identity, client-sent user ids ignored, role checks, privacy of other bookings, CSRF guard | `tests/integration/auth-and-access.test.ts` |

## Local development (without Docker for app code)

```bash
docker compose up -d db
cd backend && npm install && cp .env.example .env && npx prisma migrate deploy && npm run db:seed && npm run dev
# in another terminal
cd frontend && npm install && npm run dev       # http://localhost:5173, proxies /api to :4000
```

## Architecture

```
 Browser (React SPA)
        │  same-origin /api, HttpOnly session cookie
        ▼
 ┌──────────────┐     /api/*      ┌───────────────────────────────────────────┐
 │ nginx (web)  │ ──────────────▶ │ API (Express)                             │
 │ static SPA   │                 │  routes → services → domain (pure logic)  │
 └──────────────┘                 │                                           │
                                  │  reminder worker (same process, polls DB) │
                                  └───────────────────┬───────────────────────┘
                                                      │ Prisma
                                                      ▼
                                  ┌───────────────────────────────────────────┐
                                  │ PostgreSQL                                │
                                  │  users, auth_sessions, weekly_availability│
                                  │  blocked_dates, bookings (+ exclusion     │
                                  │  constraints), reminders, notifications   │
                                  └───────────────────────────────────────────┘
```

**Backend layout (`backend/src`)**

- `domain/`: pure functions with no I/O, which hold the rules and get the most unit tests.
  - `slots.ts`: slot generation, DST handling, grouping by the viewer's timezone
  - `policy.ts`: the 24-hour rule
  - `reminders.ts`: reminder planning, delivery decisions, message formatting
- `services/`: database work and transactions.
  - `bookingService.ts`: create, cancel and atomic reschedule
  - `availabilityService.ts`: free slots
  - `reminderWorker.ts`: exactly-once delivery
- `routes/`: HTTP and validation (zod). They identify the caller only through `requireAuth`.
- `auth/auth.ts`: password hashing (bcrypt), opaque session tokens (only a hash is stored), role guards
- `lib/clock.ts`: the single source of "now", so tests can pin time

**Request flow for a booking:**

1. Validate that the time is one of the professional's generated slots.
2. In one transaction, insert the booking and its reminders, plus a notification for the professional.
3. The Postgres exclusion constraints reject overlaps atomically, and those rejections become `409` responses.

### API summary

| Method | Path | Who |
|--------|------|-----|
| POST | `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout` | anyone |
| GET | `/api/auth/me` | logged in |
| GET | `/api/professionals`, `/api/professionals/:id` | logged in |
| GET | `/api/professionals/:id/slots` | logged in (free times only, grouped in the caller's timezone) |
| GET | `/api/bookings` | own sessions: a member's bookings, or a professional's schedule |
| POST | `/api/bookings` | member |
| POST | `/api/bookings/:id/cancel` | the member (≥24h before) or the professional (before start) |
| POST | `/api/bookings/:id/reschedule` | the member (≥24h before) |
| GET/PUT | `/api/me/availability` | professional |
| GET/POST/DELETE | `/api/me/blocked-dates` | professional |
| GET | `/api/notifications` | own |
| POST | `/api/notifications/:id/read`, `/api/notifications/read-all` | own |

Errors have the shape `{ "error": { "code": "SLOT_UNAVAILABLE", "message": "…" } }`.
