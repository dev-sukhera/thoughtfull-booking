function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export const config = {
  port: intFromEnv('PORT', 4000),
  reminderPollMs: intFromEnv('REMINDER_POLL_MS', 10_000),
  sessionTtlDays: intFromEnv('SESSION_TTL_DAYS', 7),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  seedDemoData: process.env.SEED_DEMO_DATA === 'true',
};
