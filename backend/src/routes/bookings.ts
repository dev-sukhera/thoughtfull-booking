import { Router } from 'express';
import { z } from 'zod';
import type { Booking } from '@prisma/client';
import { prisma } from '../lib/db';
import { clock } from '../lib/clock';
import { currentUser, requireRole } from '../auth/auth';
import { memberCanChange, memberChangeDeadline, professionalCanCancel } from '../domain/policy';
import { cancelBooking, createBooking, rescheduleBooking } from '../services/bookingService';

export const bookingsRouter = Router();

const instant = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));
const idParam = z.object({ id: z.string().uuid() });

type WithPeople = Booking & {
  professional: { id: string; name: string; title: string | null; timezone: string };
  member: { id: string; name: string };
};

/**
 * Lists only the caller's own sessions: as a member, sessions they booked; as a
 * professional, sessions booked with them. The filter comes from the session
 * cookie identity, never from a query parameter.
 */
bookingsRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const now = clock.now();
  const isMember = user.role === 'MEMBER';
  const bookings = (await prisma.booking.findMany({
    where: isMember
      ? { memberId: user.id, status: { in: ['BOOKED', 'CANCELLED'] } }
      : { professionalId: user.id, status: { in: ['BOOKED', 'CANCELLED'] } },
    include: {
      professional: { select: { id: true, name: true, title: true, timezone: true } },
      member: { select: { id: true, name: true } },
    },
    orderBy: { startsAt: 'asc' },
  })) as WithPeople[];

  const view = (b: WithPeople) => {
    const upcoming = b.status === 'BOOKED' && b.endsAt > now;
    const canChange = upcoming && (isMember ? memberCanChange(b.startsAt, now) : professionalCanCancel(b.startsAt, now));
    return {
      id: b.id,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      status: b.status,
      cancelledByRole: b.cancelledByRole,
      professional: b.professional,
      // A member's own name is not useful to them; professionals see who they are meeting.
      member: isMember ? undefined : b.member,
      canCancel: canChange,
      canReschedule: isMember && canChange,
      changeDeadline: isMember ? memberChangeDeadline(b.startsAt).toISOString() : null,
    };
  };

  res.json({
    upcoming: bookings.filter((b) => b.status === 'BOOKED' && b.endsAt > now).map(view),
    past: bookings
      .filter((b) => b.status === 'BOOKED' && b.endsAt <= now)
      .reverse()
      .map(view),
    cancelled: bookings
      .filter((b) => b.status === 'CANCELLED')
      .reverse()
      .map(view),
  });
});

bookingsRouter.post('/', requireRole('MEMBER'), async (req, res) => {
  const body = z.object({ professionalId: z.string().uuid(), startsAt: instant }).parse(req.body);
  const booking = await createBooking(currentUser(req), body.professionalId, body.startsAt, clock.now());
  res.status(201).json({ booking: summary(booking) });
});

bookingsRouter.post('/:id/cancel', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const booking = await cancelBooking(currentUser(req), id, clock.now());
  res.json({ booking: summary(booking) });
});

bookingsRouter.post('/:id/reschedule', requireRole('MEMBER'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { startsAt } = z.object({ startsAt: instant }).parse(req.body);
  const booking = await rescheduleBooking(currentUser(req), id, startsAt, clock.now());
  res.json({ booking: summary(booking) });
});

function summary(b: Booking) {
  return {
    id: b.id,
    professionalId: b.professionalId,
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    status: b.status,
    rescheduledFromId: b.rescheduledFromId,
  };
}
