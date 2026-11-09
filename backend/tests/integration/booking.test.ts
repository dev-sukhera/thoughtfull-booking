import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetDb, setNow, signupMember, signupPro } from './helpers';

// Monday 2030-01-07 00:00 UTC = 08:00 in Singapore. A Singapore professional
// working 09:00-17:00 has slots at 01:00Z..08:00Z each weekday.
const NOW = '2030-01-07T00:00:00.000Z';
const TUE_0900 = '2030-01-08T01:00:00.000Z'; // 25h from NOW
const TUE_1000 = '2030-01-08T02:00:00.000Z';
const TUE_1100 = '2030-01-08T03:00:00.000Z';

beforeEach(async () => {
  await resetDb();
  setNow(NOW);
});
afterAll(() => prisma.$disconnect());

const allSlotStarts = (body: { days: Array<{ slots: Array<{ startsAt: string }> }> }) =>
  body.days.flatMap((d) => d.slots.map((s) => s.startsAt));

describe('calendar', () => {
  it('shows 4 weeks of free slots grouped in the member’s timezone', async () => {
    const pro = await signupPro('Asia/Singapore');
    const member = await signupMember('NY member', 'America/New_York');
    const res = await member.agent.get(`/api/professionals/${pro.user.id}/slots`);
    expect(res.status).toBe(200);
    expect(res.body.timezone).toBe('America/New_York');
    // Mon 09:00 SGT is Sun 20:00 in New York
    expect(res.body.days[0].date).toBe('2030-01-06');
    expect(res.body.days[0].slots[0]).toEqual({
      startsAt: '2030-01-07T01:00:00.000Z',
      endsAt: '2030-01-07T01:50:00.000Z',
      localTime: '20:00',
    });
    // 4 weeks x 5 working days x 8 slots
    expect(allSlotStarts(res.body)).toHaveLength(4 * 5 * 8);
  });

  it('removes a booked slot from everyone’s calendar, and blocked dates entirely', async () => {
    const pro = await signupPro();
    const alex = await signupMember('Alex');
    await alex.agent.post('/api/bookings').send({ professionalId: pro.user.id, startsAt: TUE_0900 });
    await pro.agent.post('/api/me/blocked-dates').send({ date: '2030-01-09', reason: 'Holiday' });

    const other = await signupMember();
    const starts = allSlotStarts((await other.agent.get(`/api/professionals/${pro.user.id}/slots`)).body);
    expect(starts).not.toContain(TUE_0900);
    expect(starts).toContain(TUE_1000);
    expect(starts.filter((s) => s.startsWith('2030-01-09'))).toEqual([]);
  });
});

describe('booking', () => {
  it('books a valid slot and schedules reminders for both people', async () => {
    const pro = await signupPro();
    const alex = await signupMember('Alex');
    const res = await alex.agent.post('/api/bookings').send({ professionalId: pro.user.id, startsAt: TUE_0900 });
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({ startsAt: TUE_0900, endsAt: '2030-01-08T01:50:00.000Z', status: 'BOOKED' });

    const reminders = await prisma.reminder.findMany({ where: { bookingId: res.body.booking.id } });
    expect(reminders).toHaveLength(4);

    const mine = await alex.agent.get('/api/bookings');
    expect(mine.body.upcoming).toHaveLength(1);
    expect(mine.body.upcoming[0]).toMatchObject({ canCancel: true, canReschedule: true });
  });

  it('accepts the same instant written with a timezone offset', async () => {
    const pro = await signupPro();
    const alex = await signupMember();
    const res = await alex.agent
      .post('/api/bookings')
      .send({ professionalId: pro.user.id, startsAt: '2030-01-08T09:00:00+08:00' });
    expect(res.status).toBe(201);
    expect(res.body.booking.startsAt).toBe(TUE_0900);
  });

  it.each([
    ['in the past', '2030-01-06T01:00:00.000Z', 'SLOT_IN_PAST'],
    ['off the slot grid', '2030-01-08T01:30:00.000Z', 'INVALID_SLOT'],
    ['outside working hours', '2030-01-08T12:00:00.000Z', 'INVALID_SLOT'],
    ['on a weekend', '2030-01-12T01:00:00.000Z', 'INVALID_SLOT'],
    ['beyond 4 weeks', '2030-02-05T01:00:00.000Z', 'INVALID_SLOT'],
  ])('rejects a time %s', async (_label, startsAt, code) => {
    const pro = await signupPro();
    const alex = await signupMember();
    const res = await alex.agent.post('/api/bookings').send({ professionalId: pro.user.id, startsAt });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe(code);
  });

  it('rejects a blocked date', async () => {
    const pro = await signupPro();
    await pro.agent.post('/api/me/blocked-dates').send({ date: '2030-01-08' });
    const alex = await signupMember();
    const res = await alex.agent.post('/api/bookings').send({ professionalId: pro.user.id, startsAt: TUE_0900 });
    expect(res.status).toBe(422);
  });
});

describe('no double-booking', () => {
  it('lets exactly one of many simultaneous requests for the same slot succeed', async () => {
    const pro = await signupPro();
    const members = await Promise.all(Array.from({ length: 8 }, (_, i) => signupMember(`M${i}`)));

    const results = await Promise.all(
      members.map((m) => m.agent.post('/api/bookings').send({ professionalId: pro.user.id, startsAt: TUE_0900 })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    for (const r of results.filter((r) => r.status === 409)) {
      expect(r.body.error.code).toBe('SLOT_UNAVAILABLE');
    }
    expect(await prisma.booking.count({ where: { status: 'BOOKED' } })).toBe(1);
  });

  it('stops one member booking two overlapping sessions with different professionals, even concurrently', async () => {
    const proSg = await signupPro('Asia/Singapore', '09:00', '17:00');
    const proUtc = await signupPro('UTC', '01:00', '09:00'); // same UTC slot grid
    const alex = await signupMember();

    const [a, b] = await Promise.all([
      alex.agent.post('/api/bookings').send({ professionalId: proSg.user.id, startsAt: TUE_0900 }),
      alex.agent.post('/api/bookings').send({ professionalId: proUtc.user.id, startsAt: TUE_0900 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a, b].find((r) => r.status === 409)!.body.error.code).toBe('MEMBER_OVERLAP');
  });

  it('blocks a partially overlapping session with another professional', async () => {
    const proSg = await signupPro('Asia/Singapore', '09:00', '17:00'); // slots on the hour UTC
    const proOffset = await signupPro('UTC', '01:30', '09:00'); // slots at :30 UTC
    const alex = await signupMember();
    expect((await alex.agent.post('/api/bookings').send({ professionalId: proSg.user.id, startsAt: TUE_0900 })).status).toBe(201);
    const res = await alex.agent
      .post('/api/bookings')
      .send({ professionalId: proOffset.user.id, startsAt: '2030-01-08T01:30:00.000Z' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MEMBER_OVERLAP');
  });

  it('frees the slot again after a cancellation', async () => {
    const pro = await signupPro();
    const alex = await signupMember();
    const jordan = await signupMember();
    const first = await alex.agent.post('/api/bookings').send({ professionalId: pro.user.id, startsAt: TUE_0900 });
    await alex.agent.post(`/api/bookings/${first.body.booking.id}/cancel`).send({});
    const second = await jordan.agent.post('/api/bookings').send({ professionalId: pro.user.id, startsAt: TUE_0900 });
    expect(second.status).toBe(201);
  });
});

describe('cancel and the 24-hour rule', () => {
  async function bookedTuesday() {
    const pro = await signupPro();
    const alex = await signupMember('Alex');
    const res = await alex.agent.post('/api/bookings').send({ professionalId: pro.user.id, startsAt: TUE_0900 });
    return { pro, alex, id: res.body.booking.id as string };
  }

  it('lets a member cancel at exactly 24h before, and cancels pending reminders', async () => {
    const { alex, pro, id } = await bookedTuesday();
    setNow('2030-01-07T01:00:00.000Z'); // exactly 24h before
    const res = await alex.agent.post(`/api/bookings/${id}/cancel`).send({});
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('CANCELLED');
    const reminders = await prisma.reminder.findMany({ where: { bookingId: id } });
    expect(reminders.every((r) => r.status === 'CANCELLED')).toBe(true);

    const proNotes = await pro.agent.get('/api/notifications');
    expect(proNotes.body.notifications.map((n: { type: string }) => n.type)).toContain('BOOKING_CANCELLED');
  });

  it('blocks member cancel and reschedule within 24h with a clear message', async () => {
    const { alex, id } = await bookedTuesday();
    setNow('2030-01-07T01:00:00.001Z'); // 1 ms inside the window

    const cancel = await alex.agent.post(`/api/bookings/${id}/cancel`).send({});
    expect(cancel.status).toBe(409);
    expect(cancel.body.error.code).toBe('CHANGE_WINDOW_CLOSED');
    expect(cancel.body.error.message).toMatch(/24 hours/);

    const resched = await alex.agent.post(`/api/bookings/${id}/reschedule`).send({ startsAt: TUE_1000 });
    expect(resched.status).toBe(409);
    expect(resched.body.error.code).toBe('CHANGE_WINDOW_CLOSED');

    const list = await alex.agent.get('/api/bookings');
    expect(list.body.upcoming[0]).toMatchObject({ canCancel: false, canReschedule: false });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe('BOOKED');
  });

  it('lets the professional cancel at any time before the start, even within 24h', async () => {
    const { pro, alex, id } = await bookedTuesday();
    setNow('2030-01-08T00:55:00.000Z'); // 5 minutes before
    const res = await pro.agent.post(`/api/bookings/${id}/cancel`).send({});
    expect(res.status).toBe(200);
    const notes = await alex.agent.get('/api/notifications');
    expect(notes.body.notifications[0]).toMatchObject({ type: 'BOOKING_CANCELLED' });
  });

  it('does not cancel twice', async () => {
    const { alex, id } = await bookedTuesday();
    await alex.agent.post(`/api/bookings/${id}/cancel`).send({});
    const again = await alex.agent.post(`/api/bookings/${id}/cancel`).send({});
    expect(again.status).toBe(409);
  });
});

describe('reschedule', () => {
  async function setup() {
    const pro = await signupPro();
    const alex = await signupMember('Alex');
    const res = await alex.agent.post('/api/bookings').send({ professionalId: pro.user.id, startsAt: TUE_0900 });
    return { pro, alex, id: res.body.booking.id as string };
  }

  const activeFor = (memberId: string) => prisma.booking.findMany({ where: { memberId, status: 'BOOKED' } });

  it('moves the session and its reminders in one step', async () => {
    const { alex, id } = await setup();
    const res = await alex.agent.post(`/api/bookings/${id}/reschedule`).send({ startsAt: TUE_1100 });
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ startsAt: TUE_1100, status: 'BOOKED', rescheduledFromId: id });

    const old = await prisma.booking.findUniqueOrThrow({ where: { id }, include: { reminders: true } });
    expect(old.status).toBe('RESCHEDULED');
    expect(old.reminders.every((r) => r.status === 'CANCELLED')).toBe(true);

    const fresh = await prisma.reminder.findMany({ where: { bookingId: res.body.booking.id } });
    expect(fresh).toHaveLength(4);
    expect(fresh.every((r) => r.status === 'PENDING')).toBe(true);

    const active = await activeFor(alex.user.id);
    expect(active.map((b) => b.startsAt.toISOString())).toEqual([TUE_1100]);
  });

  it('keeps the original session untouched when the new slot is taken', async () => {
    const { pro, alex, id } = await setup();
    const jordan = await signupMember();
    await jordan.agent.post('/api/bookings').send({ professionalId: pro.user.id, startsAt: TUE_1000 });

    const res = await alex.agent.post(`/api/bookings/${id}/reschedule`).send({ startsAt: TUE_1000 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');

    const original = await prisma.booking.findUniqueOrThrow({ where: { id }, include: { reminders: true } });
    expect(original.status).toBe('BOOKED');
    expect(original.reminders.every((r) => r.status === 'PENDING')).toBe(true);
    expect(await activeFor(alex.user.id)).toHaveLength(1);
  });

  it('never ends with two sessions when the same booking is rescheduled twice at once', async () => {
    const { alex, id } = await setup();
    const [a, b] = await Promise.all([
      alex.agent.post(`/api/bookings/${id}/reschedule`).send({ startsAt: TUE_1000 }),
      alex.agent.post(`/api/bookings/${id}/reschedule`).send({ startsAt: TUE_1100 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await activeFor(alex.user.id)).toHaveLength(1);
  });

  it('rejects rescheduling to an invalid time and keeps the original', async () => {
    const { alex, id } = await setup();
    const res = await alex.agent.post(`/api/bookings/${id}/reschedule`).send({ startsAt: '2030-01-08T01:15:00.000Z' });
    expect(res.status).toBe(422);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe('BOOKED');
  });
});
