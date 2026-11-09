import { describe, expect, it } from 'vitest';
import { memberCanChange, memberChangeDeadline, professionalCanCancel } from '../../src/domain/policy';
import { decideDelivery, planReminders, reminderMessage } from '../../src/domain/reminders';

const H = 60 * 60 * 1000;
const start = new Date('2030-01-10T10:00:00Z');
const at = (msBeforeStart: number) => new Date(start.getTime() - msBeforeStart);

describe('24-hour rule for members', () => {
  it('allows changes more than 24h before the start', () => {
    expect(memberCanChange(start, at(48 * H))).toBe(true);
  });

  it('allows changes at exactly 24h before the start', () => {
    expect(memberCanChange(start, at(24 * H))).toBe(true);
  });

  it('blocks changes one millisecond inside the 24h window', () => {
    expect(memberCanChange(start, at(24 * H - 1))).toBe(false);
  });

  it('blocks changes after the session has started', () => {
    expect(memberCanChange(start, new Date(start.getTime() + 1))).toBe(false);
  });

  it('exposes the deadline', () => {
    expect(memberChangeDeadline(start).toISOString()).toBe('2030-01-09T10:00:00.000Z');
  });
});

describe('professional cancellation', () => {
  it('is allowed any time before the start, even within 24h', () => {
    expect(professionalCanCancel(start, at(1000))).toBe(true);
  });
  it('is not allowed once the session has started', () => {
    expect(professionalCanCancel(start, start)).toBe(false);
  });
});

describe('planReminders', () => {
  const users = ['member', 'pro'];

  it('schedules 24h and 1h reminders for both participants', () => {
    const planned = planReminders(start, at(72 * H), users);
    expect(planned).toEqual([
      { userId: 'member', kind: 'BEFORE_24H', remindAt: new Date('2030-01-09T10:00:00Z') },
      { userId: 'pro', kind: 'BEFORE_24H', remindAt: new Date('2030-01-09T10:00:00Z') },
      { userId: 'member', kind: 'BEFORE_1H', remindAt: new Date('2030-01-10T09:00:00Z') },
      { userId: 'pro', kind: 'BEFORE_1H', remindAt: new Date('2030-01-10T09:00:00Z') },
    ]);
  });

  it('skips the 24h reminder when booking less than 24h ahead', () => {
    const planned = planReminders(start, at(5 * H), users);
    expect(planned.map((r) => r.kind)).toEqual(['BEFORE_1H', 'BEFORE_1H']);
  });

  it('skips a reminder whose time is exactly now', () => {
    expect(planReminders(start, at(24 * H), users).map((r) => r.kind)).toEqual(['BEFORE_1H', 'BEFORE_1H']);
    expect(planReminders(start, at(1 * H), users)).toEqual([]);
  });

  it('creates nothing when booking less than 1h ahead', () => {
    expect(planReminders(start, at(30 * 60 * 1000), users)).toEqual([]);
  });
});

describe('decideDelivery', () => {
  it('delivers a due reminder for an upcoming booked session', () => {
    expect(decideDelivery({ status: 'BOOKED', startsAt: start }, at(H))).toBe('DELIVER');
  });
  it('expires a reminder whose session already started (e.g. after downtime)', () => {
    expect(decideDelivery({ status: 'BOOKED', startsAt: start }, start)).toBe('EXPIRE');
  });
  it('cancels a reminder for a session that is no longer booked', () => {
    expect(decideDelivery({ status: 'CANCELLED', startsAt: start }, at(H))).toBe('CANCEL');
  });
});

describe('reminderMessage', () => {
  it('formats the start time in the recipient’s timezone', () => {
    const msg = reminderMessage({
      kind: 'BEFORE_1H',
      startsAt: start,
      recipientTimezone: 'Asia/Singapore',
      otherPartyName: 'Sam',
    });
    expect(msg.title).toBe('Session in 1 hour');
    expect(msg.body).toContain('Thu 10 Jan 2030, 18:00');
    expect(msg.body).toContain('Sam');
  });
});
