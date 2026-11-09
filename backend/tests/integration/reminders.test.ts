import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetDb, setNow, signupMember, signupPro } from './helpers';
import { deliverDueReminders } from '../../src/services/reminderWorker';

const NOW = '2030-01-07T00:00:00.000Z';
const TUE_0900_SGT = '2030-01-08T01:00:00.000Z'; // 25h after NOW
const MON_1300_SGT = '2030-01-07T05:00:00.000Z'; // 5h after NOW

beforeEach(async () => {
  await resetDb();
  setNow(NOW);
});
afterAll(() => prisma.$disconnect());

async function book(startsAt: string) {
  const pro = await signupPro('Asia/Singapore', '09:00', '17:00', 'Dr Pro');
  const member = await signupMember('Alex', 'Europe/London');
  const res = await member.agent.post('/api/bookings').send({ professionalId: pro.user.id, startsAt });
  expect(res.status).toBe(201);
  return { pro, member, bookingId: res.body.booking.id as string };
}

const reminderNotifications = (userId: string) =>
  prisma.notification.findMany({ where: { userId, type: 'REMINDER' }, orderBy: { createdAt: 'asc' } });

describe('reminder scheduling', () => {
  it('creates 24h and 1h reminders for both participants', async () => {
    const { bookingId } = await book(TUE_0900_SGT);
    const reminders = await prisma.reminder.findMany({ where: { bookingId }, orderBy: [{ remindAt: 'asc' }] });
    expect(reminders.map((r) => [r.kind, r.remindAt.toISOString(), r.status])).toEqual([
      ['BEFORE_24H', '2030-01-07T01:00:00.000Z', 'PENDING'],
      ['BEFORE_24H', '2030-01-07T01:00:00.000Z', 'PENDING'],
      ['BEFORE_1H', '2030-01-08T00:00:00.000Z', 'PENDING'],
      ['BEFORE_1H', '2030-01-08T00:00:00.000Z', 'PENDING'],
    ]);
  });

  it('does not create a reminder whose time already passed at booking', async () => {
    const { bookingId } = await book(MON_1300_SGT);
    const reminders = await prisma.reminder.findMany({ where: { bookingId } });
    expect(reminders.map((r) => r.kind)).toEqual(['BEFORE_1H', 'BEFORE_1H']);
  });
});

describe('reminder delivery', () => {
  it('delivers each due reminder exactly once as an in-app notification', async () => {
    const { pro, member } = await book(TUE_0900_SGT);

    // Nothing is due yet
    expect((await deliverDueReminders(new Date(NOW))).sent).toBe(0);

    // 24h reminder time
    const at24 = new Date('2030-01-07T01:00:00.000Z');
    expect((await deliverDueReminders(at24)).sent).toBe(2);
    expect((await deliverDueReminders(at24)).sent).toBe(0); // running again sends nothing new

    const memberNotes = await reminderNotifications(member.user.id);
    expect(memberNotes).toHaveLength(1);
    expect(memberNotes[0].title).toBe('Session tomorrow');
    // Shown in the member's own timezone (London, GMT in January): 01:00
    expect(memberNotes[0].body).toContain('Tue 8 Jan 2030, 01:00');
    expect(memberNotes[0].body).toContain('Dr Pro');

    const proNotes = await reminderNotifications(pro.user.id);
    expect(proNotes).toHaveLength(1);
    expect(proNotes[0].body).toContain('09:00'); // Singapore time
    expect(proNotes[0].body).toContain('Alex');

    // 1h reminder time
    const at1 = new Date('2030-01-08T00:00:00.000Z');
    expect((await deliverDueReminders(at1)).sent).toBe(2);
    expect(await reminderNotifications(member.user.id)).toHaveLength(2);

    // Visible through the API
    const api = await member.agent.get('/api/notifications');
    expect(api.body.notifications.map((n: { title: string }) => n.title)).toEqual(
      expect.arrayContaining(['Session tomorrow', 'Session in 1 hour']),
    );
  });

  it('delivers exactly once even when several workers run at the same time', async () => {
    const { bookingId } = await book(TUE_0900_SGT);
    const due = new Date('2030-01-08T00:30:00.000Z'); // both 24h and 1h are due
    const results = await Promise.all(Array.from({ length: 6 }, () => deliverDueReminders(due)));
    expect(results.reduce((sum, r) => sum + r.sent, 0)).toBe(4);
    expect(await prisma.notification.count({ where: { bookingId, type: 'REMINDER' } })).toBe(4);
  });

  it('catches up after downtime: reminders stored in the DB are delivered on the next run', async () => {
    // Simulates a restart: the reminder came due while nothing was running.
    const { member } = await book(TUE_0900_SGT);
    const afterDowntime = new Date('2030-01-07T20:00:00.000Z'); // 24h reminder 19h overdue, session not started
    expect((await deliverDueReminders(afterDowntime)).sent).toBe(2);
    expect(await reminderNotifications(member.user.id)).toHaveLength(1);
  });

  it('expires reminders whose session already started instead of sending stale ones', async () => {
    const { member, bookingId } = await book(TUE_0900_SGT);
    const result = await deliverDueReminders(new Date('2030-01-08T01:05:00.000Z'));
    expect(result).toEqual({ sent: 0, expired: 4, cancelled: 0 });
    expect(await reminderNotifications(member.user.id)).toHaveLength(0);
    const statuses = (await prisma.reminder.findMany({ where: { bookingId } })).map((r) => r.status);
    expect(statuses).toEqual(['EXPIRED', 'EXPIRED', 'EXPIRED', 'EXPIRED']);
  });

  it('never delivers reminders for a cancelled session', async () => {
    const { member, bookingId } = await book(TUE_0900_SGT);
    await member.agent.post(`/api/bookings/${bookingId}/cancel`).send({});
    const result = await deliverDueReminders(new Date('2030-01-08T00:30:00.000Z'));
    expect(result.sent).toBe(0);
    expect(await reminderNotifications(member.user.id)).toHaveLength(0);
  });

  it('after a reschedule, reminders follow the new time', async () => {
    const { member, bookingId } = await book(TUE_0900_SGT);
    const moved = await member.agent
      .post(`/api/bookings/${bookingId}/reschedule`)
      .send({ startsAt: '2030-01-09T01:00:00.000Z' }); // Wed 09:00 SGT

    // The old 24h time passes: nothing is sent for the old slot
    expect((await deliverDueReminders(new Date('2030-01-07T01:00:00.000Z'))).sent).toBe(0);
    // The new 24h time: delivered for the new booking
    expect((await deliverDueReminders(new Date('2030-01-08T01:00:00.000Z'))).sent).toBe(2);
    const notes = await reminderNotifications(member.user.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].bookingId).toBe(moved.body.booking.id);
  });
});
