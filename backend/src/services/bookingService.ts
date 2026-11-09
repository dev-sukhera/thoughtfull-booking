import type { Booking, Role } from '@prisma/client';
import { prisma, Tx } from '../lib/db';
import { HttpError, notFound } from '../lib/errors';
import { memberCanChange, professionalCanCancel } from '../domain/policy';
import { planReminders, formatForUser } from '../domain/reminders';
import { findSlotForStart } from './availabilityService';
import type { AuthUser } from '../auth/auth';

const PRO_OVERLAP = 'bookings_no_professional_overlap';
const MEMBER_OVERLAP = 'bookings_no_member_overlap';

export const slotTaken = () =>
  new HttpError(409, 'SLOT_UNAVAILABLE', 'Sorry, this time was just booked by someone else. Please pick another time.');
export const memberOverlap = () =>
  new HttpError(409, 'MEMBER_OVERLAP', 'You already have a session that overlaps this time.');
export const cutoffPassed = () =>
  new HttpError(
    409,
    'CHANGE_WINDOW_CLOSED',
    'Sessions can only be cancelled or rescheduled up to 24 hours before they start. Please contact your professional if you need help.',
  );

/**
 * Map a Postgres exclusion-constraint violation (SQLSTATE 23P01) raised during an
 * insert into a friendly 409. Prisma surfaces these as an unknown request error
 * whose message names the constraint.
 */
function translateOverlapError(err: unknown): never {
  const text = err instanceof Error ? err.message : String(err);
  if (text.includes(PRO_OVERLAP)) throw slotTaken();
  if (text.includes(MEMBER_OVERLAP)) throw memberOverlap();
  throw err;
}

async function insertBookingWithReminders(
  tx: Tx,
  input: { memberId: string; professionalId: string; startsAt: Date; endsAt: Date; rescheduledFromId?: string },
  now: Date,
): Promise<Booking> {
  let booking: Booking;
  try {
    booking = await tx.booking.create({ data: { ...input, status: 'BOOKED' } });
  } catch (err) {
    translateOverlapError(err);
  }
  const reminders = planReminders(booking.startsAt, now, [input.memberId, input.professionalId]);
  if (reminders.length > 0) {
    await tx.reminder.createMany({
      data: reminders.map((r) => ({ bookingId: booking.id, userId: r.userId, kind: r.kind, remindAt: r.remindAt })),
    });
  }
  return booking;
}

async function requireValidSlot(professionalId: string, startsAt: Date, now: Date) {
  if (startsAt.getTime() <= now.getTime()) {
    throw new HttpError(422, 'SLOT_IN_PAST', 'This time is in the past. Please pick a future time.');
  }
  const slot = await findSlotForStart(professionalId, startsAt, now);
  if (!slot) {
    throw new HttpError(422, 'INVALID_SLOT', "This time is not one of the professional's available slots.");
  }
  return slot;
}

/** Row-level lock on a booking so concurrent cancel/reschedule requests run one at a time. */
async function lockBooking(tx: Tx, bookingId: string) {
  await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
  return tx.booking.findUnique({
    where: { id: bookingId },
    include: { member: { select: { name: true, timezone: true } }, professional: { select: { name: true, timezone: true } } },
  });
}

export async function createBooking(member: AuthUser, professionalId: string, startsAt: Date, now: Date) {
  const slot = await requireValidSlot(professionalId, startsAt, now);
  return prisma.$transaction(async (tx) => {
    const booking = await insertBookingWithReminders(
      tx,
      { memberId: member.id, professionalId, startsAt: slot.startsAt, endsAt: slot.endsAt },
      now,
    );
    const pro = await tx.user.findUniqueOrThrow({ where: { id: professionalId }, select: { timezone: true } });
    await tx.notification.create({
      data: {
        userId: professionalId,
        bookingId: booking.id,
        type: 'BOOKING_CREATED',
        title: 'New session booked',
        body: `${member.name} booked a session for ${formatForUser(booking.startsAt, pro.timezone)}.`,
      },
    });
    return booking;
  });
}

async function cancelPendingReminders(tx: Tx, bookingId: string, now: Date) {
  await tx.reminder.updateMany({
    where: { bookingId, status: 'PENDING' },
    data: { status: 'CANCELLED', processedAt: now },
  });
}

export async function cancelBooking(user: AuthUser, bookingId: string, now: Date) {
  return prisma.$transaction(async (tx) => {
    const booking = await lockBooking(tx, bookingId);
    const isMember = booking?.memberId === user.id;
    const isPro = booking?.professionalId === user.id;
    // 404 rather than 403 so other people's booking ids are not confirmed to exist.
    if (!booking || (!isMember && !isPro)) throw notFound('Session');
    if (booking.status !== 'BOOKED') {
      throw new HttpError(409, 'NOT_ACTIVE', 'This session has already been cancelled or rescheduled.');
    }
    if (isMember && !memberCanChange(booking.startsAt, now)) throw cutoffPassed();
    if (isPro && !professionalCanCancel(booking.startsAt, now)) {
      throw new HttpError(409, 'ALREADY_STARTED', 'This session has already started.');
    }

    const cancelledByRole: Role = isMember ? 'MEMBER' : 'PROFESSIONAL';
    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: { status: 'CANCELLED', cancelledAt: now, cancelledByRole },
    });
    await cancelPendingReminders(tx, booking.id, now);

    const otherId = isMember ? booking.professionalId : booking.memberId;
    const other = isMember ? booking.professional : booking.member;
    await tx.notification.create({
      data: {
        userId: otherId,
        bookingId: booking.id,
        type: 'BOOKING_CANCELLED',
        title: 'Session cancelled',
        body: `${user.name} cancelled the session on ${formatForUser(booking.startsAt, other.timezone)}.`,
      },
    });
    return updated;
  });
}

/**
 * Atomic reschedule: inside ONE transaction the old booking is marked
 * RESCHEDULED and the new one is inserted. If the insert fails (slot taken,
 * overlap), the whole transaction rolls back and the original session stays
 * exactly as it was. The member therefore always ends with exactly one session.
 */
export async function rescheduleBooking(member: AuthUser, bookingId: string, newStartsAt: Date, now: Date) {
  return prisma.$transaction(async (tx) => {
    const booking = await lockBooking(tx, bookingId);
    if (!booking || booking.memberId !== member.id) throw notFound('Session');
    if (booking.status !== 'BOOKED') {
      throw new HttpError(409, 'NOT_ACTIVE', 'This session has already been cancelled or rescheduled.');
    }
    if (!memberCanChange(booking.startsAt, now)) throw cutoffPassed();
    if (booking.startsAt.getTime() === newStartsAt.getTime()) {
      throw new HttpError(422, 'SAME_TIME', 'Please pick a different time.');
    }
    const slot = await requireValidSlot(booking.professionalId, newStartsAt, now);

    await tx.booking.update({
      where: { id: booking.id },
      data: { status: 'RESCHEDULED', cancelledAt: now, cancelledByRole: 'MEMBER' },
    });
    await cancelPendingReminders(tx, booking.id, now);
    const created = await insertBookingWithReminders(
      tx,
      {
        memberId: booking.memberId,
        professionalId: booking.professionalId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        rescheduledFromId: booking.id,
      },
      now,
    );
    const proTz = booking.professional.timezone;
    await tx.notification.create({
      data: {
        userId: booking.professionalId,
        bookingId: created.id,
        type: 'BOOKING_RESCHEDULED',
        title: 'Session rescheduled',
        body: `${member.name} moved their session from ${formatForUser(booking.startsAt, proTz)} to ${formatForUser(created.startsAt, proTz)}.`,
      },
    });
    return created;
  });
}
