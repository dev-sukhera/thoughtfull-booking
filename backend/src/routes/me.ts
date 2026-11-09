import { Router } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { prisma } from '../lib/db';
import { currentUser, requireRole } from '../auth/auth';
import { HttpError } from '../lib/errors';
import { formatTimeOfDay, parseTimeOfDay } from '../domain/slots';

/** Endpoints for a professional managing their own availability. */
export const meRouter = Router();
meRouter.use(requireRole('PROFESSIONAL'));

const timeString = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:mm');
const availabilitySchema = z.object({
  days: z
    .array(z.object({ weekday: z.number().int().min(1).max(7), start: timeString, end: timeString }))
    .max(7)
    .refine((days) => new Set(days.map((d) => d.weekday)).size === days.length, 'Each weekday can appear once'),
});

meRouter.get('/availability', async (req, res) => {
  const user = currentUser(req);
  const rows = await prisma.weeklyAvailability.findMany({
    where: { professionalId: user.id },
    orderBy: { weekday: 'asc' },
  });
  res.json({
    timezone: user.timezone,
    days: rows.map((r) => ({ weekday: r.weekday, start: formatTimeOfDay(r.startMinute), end: formatTimeOfDay(r.endMinute) })),
  });
});

/**
 * Replace the weekly hours. Existing bookings are kept even if they now fall
 * outside the new hours: changing hours must not silently cancel anyone's session.
 */
meRouter.put('/availability', async (req, res) => {
  const user = currentUser(req);
  const { days } = availabilitySchema.parse(req.body);
  const rows = days.map((d) => {
    const startMinute = parseTimeOfDay(d.start);
    const endMinute = parseTimeOfDay(d.end);
    if (startMinute === null || endMinute === null || startMinute >= endMinute) {
      throw new HttpError(400, 'INVALID_HOURS', `Invalid hours for weekday ${d.weekday}: start must be before end`);
    }
    return { professionalId: user.id, weekday: d.weekday, startMinute, endMinute };
  });
  await prisma.$transaction([
    prisma.weeklyAvailability.deleteMany({ where: { professionalId: user.id } }),
    prisma.weeklyAvailability.createMany({ data: rows }),
  ]);
  res.json({ timezone: user.timezone, days });
});

const blockedSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((d) => DateTime.fromISO(d).isValid, 'Invalid date'),
  reason: z.string().trim().max(200).optional(),
});

meRouter.get('/blocked-dates', async (req, res) => {
  const user = currentUser(req);
  const rows = await prisma.blockedDate.findMany({ where: { professionalId: user.id }, orderBy: { date: 'asc' } });
  res.json({ blockedDates: rows.map(({ id, date, reason }) => ({ id, date, reason })) });
});

meRouter.post('/blocked-dates', async (req, res) => {
  const user = currentUser(req);
  const { date, reason } = blockedSchema.parse(req.body);
  const row = await prisma.blockedDate.upsert({
    where: { professionalId_date: { professionalId: user.id, date } },
    create: { professionalId: user.id, date, reason: reason || null },
    update: { reason: reason || null },
  });
  res.status(201).json({ blockedDate: { id: row.id, date: row.date, reason: row.reason } });
});

meRouter.delete('/blocked-dates/:id', async (req, res) => {
  const user = currentUser(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { count } = await prisma.blockedDate.deleteMany({ where: { id, professionalId: user.id } });
  if (count === 0) throw new HttpError(404, 'NOT_FOUND', 'Blocked date not found');
  res.status(204).end();
});
