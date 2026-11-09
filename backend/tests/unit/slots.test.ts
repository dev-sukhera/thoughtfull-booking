import { describe, expect, it } from 'vitest';
import {
  bookingWindow,
  generateSlots,
  groupSlotsByLocalDate,
  parseTimeOfDay,
  SESSION_MINUTES,
  WeeklyHours,
} from '../../src/domain/slots';

const iso = (d: Date) => d.toISOString();
const weekdays = (start: string, end: string, days = [1, 2, 3, 4, 5]): WeeklyHours[] =>
  days.map((weekday) => ({ weekday, startMinute: parseTimeOfDay(start)!, endMinute: parseTimeOfDay(end)! }));

describe('generateSlots: layout', () => {
  // Monday 2030-01-07, 00:00 UTC = 08:00 in Singapore (UTC+8, no DST)
  const now = new Date('2030-01-07T00:00:00Z');

  it('lays out 50-minute slots every hour inside the working hours, in UTC', () => {
    const slots = generateSlots({
      weeklyHours: weekdays('09:00', '17:00', [1]),
      timezone: 'Asia/Singapore',
      from: now,
      to: new Date('2030-01-08T00:00:00Z'),
    });
    // 09:00..16:00 SGT = 01:00..08:00 UTC; 16:00-16:50 is the last that fits before 17:00
    expect(slots.map((s) => iso(s.startsAt))).toEqual([
      '2030-01-07T01:00:00.000Z',
      '2030-01-07T02:00:00.000Z',
      '2030-01-07T03:00:00.000Z',
      '2030-01-07T04:00:00.000Z',
      '2030-01-07T05:00:00.000Z',
      '2030-01-07T06:00:00.000Z',
      '2030-01-07T07:00:00.000Z',
      '2030-01-07T08:00:00.000Z',
    ]);
    for (const s of slots) {
      expect(s.endsAt.getTime() - s.startsAt.getTime()).toBe(SESSION_MINUTES * 60_000);
    }
  });

  it('never produces a slot that runs past the end of the working hours', () => {
    const slots = generateSlots({
      weeklyHours: weekdays('09:00', '11:30', [1]),
      timezone: 'UTC',
      from: now,
      to: new Date('2030-01-08T00:00:00Z'),
    });
    // 09:00, 10:00 fit; 11:00-11:50 would end after 11:30
    expect(slots.map((s) => iso(s.startsAt))).toEqual([
      '2030-01-07T09:00:00.000Z',
      '2030-01-07T10:00:00.000Z',
    ]);
  });

  it('aligns slots to the start of the working day, e.g. 09:30', () => {
    const slots = generateSlots({
      weeklyHours: weekdays('09:30', '12:00', [1]),
      timezone: 'UTC',
      from: now,
      to: new Date('2030-01-08T00:00:00Z'),
    });
    expect(slots.map((s) => iso(s.startsAt))).toEqual([
      '2030-01-07T09:30:00.000Z',
      '2030-01-07T10:30:00.000Z',
    ]);
  });

  it('supports working hours that end at midnight (24:00)', () => {
    const slots = generateSlots({
      weeklyHours: weekdays('22:00', '24:00', [1]),
      timezone: 'UTC',
      from: now,
      to: new Date('2030-01-08T00:00:00Z'),
    });
    expect(slots.map((s) => iso(s.startsAt))).toEqual([
      '2030-01-07T22:00:00.000Z',
      '2030-01-07T23:00:00.000Z',
    ]);
  });

  it('only uses the days of the week that have hours', () => {
    const slots = generateSlots({
      weeklyHours: weekdays('09:00', '10:00', [3]), // Wednesdays only
      timezone: 'UTC',
      from: now,
      to: new Date('2030-01-21T00:00:00Z'),
    });
    expect(slots.map((s) => iso(s.startsAt))).toEqual([
      '2030-01-09T09:00:00.000Z',
      '2030-01-16T09:00:00.000Z',
    ]);
  });
});

describe('generateSlots: window, past slots and busy times', () => {
  const hours = weekdays('09:00', '12:00', [1, 2, 3, 4, 5, 6, 7]);

  it('excludes slots that start now or in the past', () => {
    const slots = generateSlots({
      weeklyHours: hours,
      timezone: 'UTC',
      from: new Date('2030-01-07T10:00:00Z'), // exactly when the 10:00 slot starts
      to: new Date('2030-01-08T00:00:00Z'),
    });
    expect(slots.map((s) => iso(s.startsAt))).toEqual(['2030-01-07T11:00:00.000Z']);
  });

  it('excludes the slot that is in progress', () => {
    const slots = generateSlots({
      weeklyHours: hours,
      timezone: 'UTC',
      from: new Date('2030-01-07T09:20:00Z'),
      to: new Date('2030-01-08T00:00:00Z'),
    });
    expect(slots[0].startsAt.toISOString()).toBe('2030-01-07T10:00:00.000Z');
  });

  it('covers exactly the next 4 weeks', () => {
    const now = new Date('2030-01-07T12:00:00Z');
    const { from, to } = bookingWindow(now);
    const slots = generateSlots({ weeklyHours: hours, timezone: 'UTC', from, to });
    expect(slots[0].startsAt.toISOString()).toBe('2030-01-08T09:00:00.000Z');
    expect(slots[slots.length - 1].startsAt.toISOString()).toBe('2030-02-04T11:00:00.000Z');
    expect(slots).toHaveLength(28 * 3);
  });

  it('removes slots that overlap a busy interval', () => {
    const slots = generateSlots({
      weeklyHours: hours,
      timezone: 'UTC',
      from: new Date('2030-01-07T00:00:00Z'),
      to: new Date('2030-01-08T00:00:00Z'),
      busy: [{ start: new Date('2030-01-07T10:30:00Z'), end: new Date('2030-01-07T10:40:00Z') }],
    });
    expect(slots.map((s) => iso(s.startsAt))).toEqual([
      '2030-01-07T09:00:00.000Z',
      '2030-01-07T11:00:00.000Z',
    ]);
  });

  it('treats back-to-back intervals as not overlapping', () => {
    const slots = generateSlots({
      weeklyHours: hours,
      timezone: 'UTC',
      from: new Date('2030-01-07T00:00:00Z'),
      to: new Date('2030-01-08T00:00:00Z'),
      busy: [{ start: new Date('2030-01-07T09:50:00Z'), end: new Date('2030-01-07T10:00:00Z') }],
    });
    expect(slots).toHaveLength(3);
  });

  it('skips blocked dates, using the professional’s local calendar date', () => {
    // 2030-01-08 in Singapore runs from 2030-01-07T16:00Z to 2030-01-08T16:00Z
    const slots = generateSlots({
      weeklyHours: weekdays('09:00', '10:00', [1, 2, 3]),
      timezone: 'Asia/Singapore',
      blockedDates: ['2030-01-08'],
      from: new Date('2030-01-06T00:00:00Z'),
      to: new Date('2030-01-10T00:00:00Z'),
    });
    expect(slots.map((s) => iso(s.startsAt))).toEqual([
      '2030-01-07T01:00:00.000Z', // Mon 09:00 SGT
      '2030-01-09T01:00:00.000Z', // Wed 09:00 SGT (Tue blocked)
    ]);
  });
});

describe('generateSlots: timezones and daylight saving', () => {
  it('keeps local working hours fixed across a DST change (UTC instants shift)', () => {
    // London switches to BST (UTC+1) on Sunday 2030-03-31.
    const slots = generateSlots({
      weeklyHours: weekdays('09:00', '10:00', [5, 1]), // Fri and Mon
      timezone: 'Europe/London',
      from: new Date('2030-03-28T00:00:00Z'),
      to: new Date('2030-04-02T00:00:00Z'),
    });
    expect(slots.map((s) => iso(s.startsAt))).toEqual([
      '2030-03-29T09:00:00.000Z', // Fri 09:00 GMT
      '2030-04-01T08:00:00.000Z', // Mon 09:00 BST
    ]);
  });

  it('skips a slot whose local start time does not exist (spring forward)', () => {
    // New York jumps from 02:00 to 03:00 on Sunday 2030-03-10.
    const slots = generateSlots({
      weeklyHours: [{ weekday: 7, startMinute: 60, endMinute: 300 }], // Sun 01:00-05:00
      timezone: 'America/New_York',
      from: new Date('2030-03-09T00:00:00Z'),
      to: new Date('2030-03-11T00:00:00Z'),
    });
    expect(slots.map((s) => iso(s.startsAt))).toEqual([
      '2030-03-10T06:00:00.000Z', // 01:00 EST
      // 02:00 does not exist that night
      '2030-03-10T07:00:00.000Z', // 03:00 EDT
      '2030-03-10T08:00:00.000Z', // 04:00 EDT
    ]);
  });

  it('produces no duplicate or overlapping slots when clocks fall back', () => {
    // New York goes from 02:00 EDT back to 01:00 EST on Sunday 2030-11-03.
    const slots = generateSlots({
      weeklyHours: [{ weekday: 7, startMinute: 0, endMinute: 240 }], // Sun 00:00-04:00
      timezone: 'America/New_York',
      from: new Date('2030-11-02T00:00:00Z'),
      to: new Date('2030-11-05T00:00:00Z'),
    });
    const starts = slots.map((s) => s.startsAt.getTime());
    expect(new Set(starts).size).toBe(starts.length);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].startsAt.getTime()).toBeGreaterThanOrEqual(slots[i - 1].endsAt.getTime());
    }
    expect(slots.map((s) => iso(s.startsAt))).toEqual([
      '2030-11-03T04:00:00.000Z', // 00:00 EDT
      '2030-11-03T06:00:00.000Z', // 01:00 happens twice; Luxon resolves it to the EST one
      '2030-11-03T07:00:00.000Z', // 02:00 EST
      '2030-11-03T08:00:00.000Z', // 03:00 EST
    ]);
  });
});

describe('groupSlotsByLocalDate', () => {
  it('shows slots on the member’s own calendar day and clock time', () => {
    // A Singapore professional's Monday 09:00 is Sunday 20:00 for a New York member.
    const slots = generateSlots({
      weeklyHours: weekdays('09:00', '11:00', [1]),
      timezone: 'Asia/Singapore',
      from: new Date('2030-01-06T00:00:00Z'),
      to: new Date('2030-01-08T00:00:00Z'),
    });
    const days = groupSlotsByLocalDate(slots, 'America/New_York');
    expect(days).toEqual([
      {
        date: '2030-01-06',
        slots: [
          { startsAt: '2030-01-07T01:00:00.000Z', endsAt: '2030-01-07T01:50:00.000Z', localTime: '20:00' },
          { startsAt: '2030-01-07T02:00:00.000Z', endsAt: '2030-01-07T02:50:00.000Z', localTime: '21:00' },
        ],
      },
    ]);
  });

  it('splits one professional day across two member days when it crosses midnight', () => {
    const slots = generateSlots({
      weeklyHours: weekdays('09:00', '12:00', [1]),
      timezone: 'UTC',
      from: new Date('2030-01-07T00:00:00Z'),
      to: new Date('2030-01-08T00:00:00Z'),
    });
    // Pacific/Kiritimati is UTC+14: 09:00Z = 23:00, 10:00Z = 00:00 next day
    const days = groupSlotsByLocalDate(slots, 'Pacific/Kiritimati');
    expect(days.map((d) => [d.date, d.slots.map((s) => s.localTime)])).toEqual([
      ['2030-01-07', ['23:00']],
      ['2030-01-08', ['00:00', '01:00']],
    ]);
  });
});

describe('parseTimeOfDay', () => {
  it.each([
    ['00:00', 0],
    ['09:30', 570],
    ['24:00', 1440],
  ])('%s -> %i', (input, expected) => expect(parseTimeOfDay(input)).toBe(expected));

  it.each(['9:00', '24:01', '12:60', 'noon', ''])('rejects %j', (input) => {
    expect(parseTimeOfDay(input)).toBeNull();
  });
});
