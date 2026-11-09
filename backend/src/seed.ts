/**
 * Demo data. All people here are fictional; example.com is a reserved domain.
 * Runs only when SEED_DEMO_DATA=true and the database has no users yet, so it is
 * safe to call on every container start.
 */
import { prisma } from './lib/db';
import { hashPassword } from './auth/auth';
import { config } from './config';

export const DEMO_PASSWORD = 'Password123!';

const h = (hhmm: string) => {
  const [hh, mm] = hhmm.split(':').map(Number);
  return hh * 60 + mm;
};

const professionals = [
  {
    email: 'mei.lin@example.com',
    name: 'Dr. Mei Lin Tan',
    title: 'Counselling Psychologist',
    bio: 'Works with adults on anxiety, burnout and life transitions. Calm, structured sessions.',
    timezone: 'Asia/Singapore',
    hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '17:00' })),
  },
  {
    email: 'sam.okafor@example.com',
    name: 'Sam Okafor',
    title: 'Wellbeing Coach',
    bio: 'Helps people build sustainable habits around sleep, stress and work-life balance.',
    timezone: 'Europe/London',
    hours: [
      ...[1, 2, 3, 4].map((weekday) => ({ weekday, start: '10:00', end: '18:00' })),
      { weekday: 6, start: '09:00', end: '13:00' },
    ],
  },
  {
    email: 'priya.raman@example.com',
    name: 'Priya Raman',
    title: 'Licensed Counsellor',
    bio: 'Focus on relationships, grief and self-esteem. Evening sessions available.',
    timezone: 'America/New_York',
    hours: [2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '12:00', end: '20:00' })),
  },
];

const members = [
  { email: 'alex@example.com', name: 'Alex Rivera', timezone: 'Australia/Sydney' },
  { email: 'jordan@example.com', name: 'Jordan Lee', timezone: 'Europe/Berlin' },
];

export async function seed() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const p of professionals) {
    await prisma.user.create({
      data: {
        email: p.email,
        name: p.name,
        title: p.title,
        bio: p.bio,
        timezone: p.timezone,
        role: 'PROFESSIONAL',
        passwordHash,
        availability: {
          create: p.hours.map((x) => ({ weekday: x.weekday, startMinute: h(x.start), endMinute: h(x.end) })),
        },
      },
    });
  }
  for (const m of members) {
    await prisma.user.create({ data: { ...m, role: 'MEMBER', passwordHash } });
  }
}

async function main() {
  if (!config.seedDemoData) {
    console.log('[seed] SEED_DEMO_DATA is not "true", skipping');
    return;
  }
  if ((await prisma.user.count()) > 0) {
    console.log('[seed] users already exist, skipping');
    return;
  }
  await seed();
  console.log(`[seed] created ${professionals.length} professionals and ${members.length} members`);
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
