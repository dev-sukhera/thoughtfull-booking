import request from 'supertest';
import { expect } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/db';
import { clock } from '../../src/lib/clock';

// Safety net: these tests TRUNCATE every table.
const dbUrl = process.env.DATABASE_URL ?? '';
if (!/\/[^/?]*test[^/?]*(\?|$)/.test(dbUrl)) {
  throw new Error(
    `Integration tests must run against a database whose name contains "test" (got ${dbUrl || 'nothing'}). ` +
      'Use `docker compose run --rm test` or `npm run test:local`.',
  );
}

export const app = createApp();
export { prisma };

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE notifications, reminders, bookings, blocked_dates, weekly_availability, auth_sessions, users CASCADE',
  );
}

export function setNow(iso: string) {
  const fixed = new Date(iso);
  clock.now = () => fixed;
}

let counter = 0;

export async function signup(opts: { role: 'MEMBER' | 'PROFESSIONAL'; name?: string; timezone?: string }) {
  const agent = request.agent(app);
  counter++;
  const res = await agent.post('/api/auth/signup').send({
    email: `user${counter}-${Date.now()}@example.com`,
    password: 'Password123!',
    name: opts.name ?? `${opts.role.toLowerCase()} ${counter}`,
    role: opts.role,
    timezone: opts.timezone ?? 'UTC',
  });
  expect(res.status).toBe(201);
  return { agent, user: res.body.user as { id: string; name: string; timezone: string } };
}

export const signupMember = (name?: string, timezone = 'UTC') => signup({ role: 'MEMBER', name, timezone });

/** A professional with the same hours every weekday (Mon-Fri). */
export async function signupPro(timezone = 'Asia/Singapore', start = '09:00', end = '17:00', name?: string) {
  const pro = await signup({ role: 'PROFESSIONAL', timezone, name });
  const res = await pro.agent
    .put('/api/me/availability')
    .send({ days: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start, end })) });
  expect(res.status).toBe(200);
  return pro;
}
