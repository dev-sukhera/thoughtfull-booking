import { prisma } from '../lib/db';
import { clock } from '../lib/clock';
import { decideDelivery, reminderMessage } from '../domain/reminders';

export interface DeliveryResult {
  sent: number;
  expired: number;
  cancelled: number;
}

/**
 * Deliver every reminder that is due, exactly once.
 *
 * Each batch runs in one transaction:
 *   1. lock due PENDING reminders with FOR UPDATE SKIP LOCKED, so two workers
 *      (or two overlapping ticks) never pick the same row;
 *   2. create the in-app notification AND mark the reminder SENT together.
 * Either both happen or neither does. A crash before commit leaves the reminder
 * PENDING, and the next run (including after a restart) picks it up. A unique
 * index on notifications.reminder_id is a final guard against duplicates.
 */
export async function deliverDueReminders(now: Date = clock.now(), batchSize = 100): Promise<DeliveryResult> {
  const total: DeliveryResult = { sent: 0, expired: 0, cancelled: 0 };
  for (;;) {
    const batch = await deliverBatch(now, batchSize);
    total.sent += batch.sent;
    total.expired += batch.expired;
    total.cancelled += batch.cancelled;
    if (batch.sent + batch.expired + batch.cancelled < batchSize) return total;
  }
}

async function deliverBatch(now: Date, batchSize: number): Promise<DeliveryResult> {
  return prisma.$transaction(async (tx) => {
    const result: DeliveryResult = { sent: 0, expired: 0, cancelled: 0 };
    const due = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM reminders
      WHERE status = 'PENDING' AND remind_at <= ${now}
      ORDER BY remind_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED`;
    if (due.length === 0) return result;

    const reminders = await tx.reminder.findMany({
      where: { id: { in: due.map((d) => d.id) } },
      include: {
        user: { select: { id: true, timezone: true } },
        booking: { include: { member: { select: { name: true } }, professional: { select: { name: true } } } },
      },
    });

    for (const reminder of reminders) {
      const decision = decideDelivery(reminder.booking, now);
      if (decision === 'CANCEL' || decision === 'EXPIRE') {
        await tx.reminder.update({
          where: { id: reminder.id },
          data: { status: decision === 'CANCEL' ? 'CANCELLED' : 'EXPIRED', processedAt: now },
        });
        result[decision === 'CANCEL' ? 'cancelled' : 'expired']++;
        continue;
      }

      const isMember = reminder.userId === reminder.booking.memberId;
      const { title, body } = reminderMessage({
        kind: reminder.kind,
        startsAt: reminder.booking.startsAt,
        recipientTimezone: reminder.user.timezone,
        otherPartyName: isMember ? reminder.booking.professional.name : reminder.booking.member.name,
      });
      await tx.notification.create({
        data: {
          userId: reminder.userId,
          reminderId: reminder.id,
          bookingId: reminder.bookingId,
          type: 'REMINDER',
          title,
          body,
          createdAt: now,
        },
      });
      await tx.reminder.update({ where: { id: reminder.id }, data: { status: 'SENT', processedAt: now } });
      result.sent++;
    }
    return result;
  });
}

/**
 * Polls the reminders table. Because all state lives in Postgres, a restart
 * loses nothing: the first tick after boot delivers anything that came due
 * while the server was down (or expires it if the session already started).
 */
export function startReminderWorker(intervalMs: number): () => void {
  let running = false;
  const tick = async () => {
    if (running) return; // never overlap ticks in this process
    running = true;
    try {
      const r = await deliverDueReminders();
      if (r.sent || r.expired || r.cancelled) console.log('[reminders]', r);
    } catch (err) {
      console.error('[reminders] delivery failed, will retry next tick', err);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
