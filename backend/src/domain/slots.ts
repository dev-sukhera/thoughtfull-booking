import { DateTime } from 'luxon';

/** Every session is exactly 50 minutes. */
export const SESSION_MINUTES = 50;
/**
 * Slots start every 60 minutes from the start of the working day: a 50-minute
 * session plus a 10-minute break for the professional to write notes and reset.
 */
export const SLOT_STEP_MINUTES = 60;
/** Members can book up to 4 weeks ahead. */
export const BOOKING_WINDOW_DAYS = 28;

export interface WeeklyHours {
  /** ISO weekday, 1 = Monday ... 7 = Sunday */
  weekday: number;
  /** Minutes after local midnight (professional's timezone) */
  startMinute: number;
  /** Exclusive end, minutes after local midnight, up to 1440 */
  endMinute: number;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
}

export interface GenerateSlotsInput {
  weeklyHours: WeeklyHours[];
  /** IANA timezone of the professional, e.g. "Asia/Singapore" */
  timezone: string;
  /** YYYY-MM-DD dates (professional's timezone) with no availability */
  blockedDates?: Iterable<string>;
  /** Only slots starting strictly after this instant are returned (i.e. "now"). */
  from: Date;
  /** Only slots starting strictly before this instant are returned. */
  to: Date;
  /** Already-booked intervals; slots overlapping any of them are dropped. */
  busy?: Interval[];
}

/**
 * Resolve a wall-clock time on a given local day in the day's zone.
 * Returns null when that wall-clock time does not exist (the hour skipped by a
 * spring-forward DST change). For an ambiguous time (fall-back, when e.g. 01:00
 * happens twice), Luxon resolves it to one deterministic instant, so the slot
 * appears once rather than twice.
 */
export function resolveLocalTime(day: DateTime, minuteOfDay: number): DateTime | null {
  if (minuteOfDay === 1440) return day.plus({ days: 1 }).startOf('day');
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const dt = DateTime.fromObject(
    { year: day.year, month: day.month, day: day.day, hour, minute },
    { zone: day.zone },
  );
  // Luxon silently shifts non-existent times forward; detect that and reject.
  if (dt.hour !== hour || dt.minute !== minute) return null;
  return dt;
}

/**
 * Generate bookable slots from weekly working hours.
 *
 * Working hours are wall-clock times in the professional's timezone, so each
 * day is resolved separately: a slot at 09:00 stays at 09:00 local time across
 * a DST change, and its UTC instant moves instead. Slots are returned as UTC
 * instants, sorted, and are always fully inside the working hours.
 */
export function generateSlots(input: GenerateSlotsInput): Slot[] {
  const { timezone } = input;
  const blocked = new Set(input.blockedDates ?? []);
  const hoursByWeekday = new Map(input.weeklyHours.map((h) => [h.weekday, h]));
  const fromMs = input.from.getTime();
  const toMs = input.to.getTime();
  const busy = input.busy ?? [];

  const result = new Map<number, Slot>();
  // Pad by a day either side: the window edges are UTC instants, and the local
  // calendar day they fall on can differ from the UTC one.
  let day = DateTime.fromJSDate(input.from, { zone: timezone }).startOf('day').minus({ days: 1 });
  const lastDay = DateTime.fromJSDate(input.to, { zone: timezone }).startOf('day').plus({ days: 1 });

  for (; day <= lastDay; day = day.plus({ days: 1 }).startOf('day')) {
    const hours = hoursByWeekday.get(day.weekday);
    if (!hours || blocked.has(day.toISODate()!)) continue;

    // If the end of the working day falls in a DST gap, fall back to Luxon's
    // forward-shifted time: it is only used as an upper bound.
    const dayEnd =
      resolveLocalTime(day, hours.endMinute) ??
      day.set({ hour: Math.floor(hours.endMinute / 60), minute: hours.endMinute % 60 });

    for (
      let minute = hours.startMinute;
      minute + SESSION_MINUTES <= hours.endMinute;
      minute += SLOT_STEP_MINUTES
    ) {
      const start = resolveLocalTime(day, minute);
      if (!start) continue; // skipped by DST spring-forward
      const end = start.plus({ minutes: SESSION_MINUTES });
      if (end > dayEnd) continue;

      const startMs = start.toMillis();
      const endMs = end.toMillis();
      if (startMs <= fromMs || startMs >= toMs) continue;
      if (busy.some((b) => startMs < b.end.getTime() && b.start.getTime() < endMs)) continue;

      result.set(startMs, { startsAt: new Date(startMs), endsAt: new Date(endMs) });
    }
  }

  return [...result.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** The booking window that members see: from now until 4 weeks ahead. */
export function bookingWindow(now: Date): { from: Date; to: Date } {
  return {
    from: now,
    to: DateTime.fromJSDate(now).plus({ days: BOOKING_WINDOW_DAYS }).toJSDate(),
  };
}

export interface SlotDay {
  /** YYYY-MM-DD in the viewer's timezone */
  date: string;
  slots: Array<{ startsAt: string; endsAt: string; localTime: string }>;
}

/** Group UTC slots by calendar day in the viewer's (member's) timezone. */
export function groupSlotsByLocalDate(slots: Slot[], viewerTimezone: string): SlotDay[] {
  const days = new Map<string, SlotDay>();
  for (const slot of slots) {
    const local = DateTime.fromJSDate(slot.startsAt, { zone: viewerTimezone });
    const date = local.toISODate()!;
    let day = days.get(date);
    if (!day) {
      day = { date, slots: [] };
      days.set(date, day);
    }
    day.slots.push({
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
      localTime: local.toFormat('HH:mm'),
    });
  }
  return [...days.values()];
}

/** Parse "HH:mm" (00:00-24:00) into minutes after midnight, or null if invalid. */
export function parseTimeOfDay(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) return null;
  const total = hours * 60 + minutes;
  if (total > 1440) return null;
  return total;
}

export function formatTimeOfDay(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
