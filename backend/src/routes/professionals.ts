import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { clock } from '../lib/clock';
import { currentUser } from '../auth/auth';
import { getFreeSlots, getProfessional } from '../services/availabilityService';
import { formatTimeOfDay, groupSlotsByLocalDate, SESSION_MINUTES, BOOKING_WINDOW_DAYS } from '../domain/slots';

export const professionalsRouter = Router();

const idParam = z.object({ id: z.string().uuid() });

professionalsRouter.get('/', async (_req, res) => {
  const pros = await prisma.user.findMany({
    where: { role: 'PROFESSIONAL' },
    select: { id: true, name: true, title: true, bio: true, timezone: true },
    orderBy: { name: 'asc' },
  });
  res.json({ professionals: pros });
});

professionalsRouter.get('/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const pro = await getProfessional(id);
  res.json({
    professional: {
      id: pro.id,
      name: pro.name,
      title: pro.title,
      bio: pro.bio,
      timezone: pro.timezone,
      weeklyHours: pro.availability
        .sort((a, b) => a.weekday - b.weekday)
        .map((h) => ({ weekday: h.weekday, start: formatTimeOfDay(h.startMinute), end: formatTimeOfDay(h.endMinute) })),
    },
  });
});

/**
 * Free slots for the next 4 weeks, grouped by day in the *viewer's* timezone
 * (taken from their account, not from the client). Only times are exposed.
 */
professionalsRouter.get('/:id/slots', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const viewer = currentUser(req);
  const now = clock.now();
  const slots = await getFreeSlots(id, now);
  res.json({
    timezone: viewer.timezone,
    sessionMinutes: SESSION_MINUTES,
    windowDays: BOOKING_WINDOW_DAYS,
    generatedAt: now.toISOString(),
    days: groupSlotsByLocalDate(slots, viewer.timezone),
  });
});
