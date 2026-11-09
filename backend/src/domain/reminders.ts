import { DateTime } from 'luxon';

export type ReminderKind = 'BEFORE_24H' | 'BEFORE_1H';

export const REMINDER_OFFSETS: ReadonlyArray<{ kind: ReminderKind; minutesBefore: number }> = [
  { kind: 'BEFORE_24H', minutesBefore: 24 * 60 },
  { kind: 'BEFORE_1H', minutesBefore: 60 },
];

export interface PlannedReminder {
  userId: string;
  kind: ReminderKind;
  remindAt: Date;
}

/**
 * Reminders for one session: 24h and 1h before the start, for each participant.
 * A reminder whose time is already in the past (or exactly now) at booking time
 * is not created.
 */
export function planReminders(startsAt: Date, now: Date, userIds: string[]): PlannedReminder[] {
  const planned: PlannedReminder[] = [];
  for (const { kind, minutesBefore } of REMINDER_OFFSETS) {
    const remindAt = new Date(startsAt.getTime() - minutesBefore * 60_000);
    if (remindAt.getTime() <= now.getTime()) continue;
    for (const userId of userIds) planned.push({ userId, kind, remindAt });
  }
  return planned;
}

export type DeliveryDecision = 'DELIVER' | 'EXPIRE' | 'CANCEL';

/**
 * What the worker does with a due reminder. A reminder that is due but whose
 * session has already started (e.g. the server was down for a while) is expired
 * rather than delivered: "your session starts in 1 hour" would be wrong by then.
 */
export function decideDelivery(
  booking: { status: string; startsAt: Date },
  now: Date,
): DeliveryDecision {
  if (booking.status !== 'BOOKED') return 'CANCEL';
  if (now.getTime() >= booking.startsAt.getTime()) return 'EXPIRE';
  return 'DELIVER';
}

/** Format an instant for a person, always in their own timezone. */
export function formatForUser(instant: Date, timezone: string): string {
  return DateTime.fromJSDate(instant, { zone: timezone }).toFormat("ccc d LLL yyyy, HH:mm '('ZZZZ')'");
}

export function reminderMessage(input: {
  kind: ReminderKind;
  startsAt: Date;
  recipientTimezone: string;
  otherPartyName: string;
}): { title: string; body: string } {
  const when = formatForUser(input.startsAt, input.recipientTimezone);
  const title = input.kind === 'BEFORE_24H' ? 'Session tomorrow' : 'Session in 1 hour';
  return { title, body: `Your session with ${input.otherPartyName} starts ${when}.` };
}
