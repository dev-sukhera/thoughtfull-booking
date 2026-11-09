import { prisma } from '../lib/db';
import { bookingWindow, generateSlots, Slot } from '../domain/slots';
import { notFound } from '../lib/errors';

export async function getProfessional(professionalId: string) {
  const pro = await prisma.user.findFirst({
    where: { id: professionalId, role: 'PROFESSIONAL' },
    include: { availability: true, blockedDates: true },
  });
  if (!pro) throw notFound('Professional');
  return pro;
}

/**
 * Free slots for a professional within the booking window. Only start/end
 * times are returned: nothing about who holds the booked slots.
 */
export async function getFreeSlots(professionalId: string, now: Date): Promise<Slot[]> {
  const pro = await getProfessional(professionalId);
  const { from, to } = bookingWindow(now);
  const booked = await prisma.booking.findMany({
    where: {
      professionalId,
      status: 'BOOKED',
      startsAt: { lt: to },
      endsAt: { gt: from },
    },
    select: { startsAt: true, endsAt: true },
  });
  return generateSlots({
    weeklyHours: pro.availability,
    timezone: pro.timezone,
    blockedDates: pro.blockedDates.map((b) => b.date),
    from,
    to,
    busy: booked.map((b) => ({ start: b.startsAt, end: b.endsAt })),
  });
}

/**
 * Is `startsAt` one of the professional's generated slots right now (inside the
 * window, in the future, inside working hours, not on a blocked date)?
 * Whether it is still free is decided by the database constraint at insert time.
 */
export async function findSlotForStart(professionalId: string, startsAt: Date, now: Date): Promise<Slot | null> {
  const pro = await getProfessional(professionalId);
  const { from, to } = bookingWindow(now);
  const slots = generateSlots({
    weeklyHours: pro.availability,
    timezone: pro.timezone,
    blockedDates: pro.blockedDates.map((b) => b.date),
    from,
    to,
  });
  return slots.find((s) => s.startsAt.getTime() === startsAt.getTime()) ?? null;
}
