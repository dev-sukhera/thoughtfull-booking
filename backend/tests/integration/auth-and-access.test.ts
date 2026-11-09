import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app, prisma, resetDb, setNow, signupMember, signupPro } from './helpers';

// Monday 2030-01-07 00:00 UTC (08:00 in Singapore)
const NOW = '2030-01-07T00:00:00.000Z';
const TUE_0900_SGT = '2030-01-08T01:00:00.000Z';

beforeEach(async () => {
  await resetDb();
  setNow(NOW);
});
afterAll(() => prisma.$disconnect());

describe('auth', () => {
  it('signs up, identifies the user from the cookie, and logs out', async () => {
    const { agent, user } = await signupMember('Alex');
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ id: user.id, name: 'Alex', role: 'MEMBER' });
    expect(me.body.user.passwordHash).toBeUndefined();

    expect((await agent.post('/api/auth/logout').send({})).status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('logs in with the right password only', async () => {
    const { user } = await signupMember('Alex');
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email;
    const bad = await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' });
    expect(bad.status).toBe(401);
    const good = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' });
    expect(good.status).toBe(200);
    expect(good.headers['set-cookie'][0]).toMatch(/tf_session=.*HttpOnly/);
  });

  it('rejects an unknown timezone at sign-up', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      email: 'tz@example.com',
      password: 'Password123!',
      name: 'Tz',
      role: 'MEMBER',
      timezone: 'Mars/Olympus_Mons',
    });
    expect(res.status).toBe(400);
  });

  it('requires a session for every API route', async () => {
    for (const path of ['/api/professionals', '/api/bookings', '/api/notifications']) {
      expect((await request(app).get(path)).status).toBe(401);
    }
  });

  it('rejects a forged session cookie', async () => {
    const res = await request(app).get('/api/bookings').set('Cookie', 'tf_session=not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('ignores any user id the client sends and books as the logged-in user', async () => {
    const pro = await signupPro();
    const alex = await signupMember('Alex');
    const victim = await signupMember('Victim');
    const res = await alex.agent
      .post('/api/bookings')
      .send({ professionalId: pro.user.id, startsAt: TUE_0900_SGT, memberId: victim.user.id, userId: victim.user.id });
    expect(res.status).toBe(201);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: res.body.booking.id } });
    expect(booking.memberId).toBe(alex.user.id);
  });
});

describe('role checks', () => {
  it('only members can book', async () => {
    const pro = await signupPro();
    const otherPro = await signupPro();
    const res = await otherPro.agent.post('/api/bookings').send({ professionalId: pro.user.id, startsAt: TUE_0900_SGT });
    expect(res.status).toBe(403);
  });

  it('only professionals can edit availability', async () => {
    const member = await signupMember();
    const res = await member.agent.put('/api/me/availability').send({ days: [] });
    expect(res.status).toBe(403);
  });

  it('rejects state-changing requests that are not JSON (CSRF guard)', async () => {
    const { agent } = await signupMember();
    const res = await agent.post('/api/auth/logout').type('form').send('a=b');
    expect(res.status).toBe(415);
  });
});

describe('privacy', () => {
  it('a member viewing a calendar sees only free times, never who booked', async () => {
    const pro = await signupPro();
    const booker = await signupMember('Secret Booker');
    expect(
      (await booker.agent.post('/api/bookings').send({ professionalId: pro.user.id, startsAt: TUE_0900_SGT })).status,
    ).toBe(201);

    const other = await signupMember('Curious');
    const res = await other.agent.get(`/api/professionals/${pro.user.id}/slots`);
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('Secret Booker');
    expect(text).not.toContain(booker.user.id);
    expect(text).not.toContain(TUE_0900_SGT);
  });

  it('members only see their own sessions, and cannot touch anyone else’s', async () => {
    const pro = await signupPro();
    const alex = await signupMember('Alex');
    const jordan = await signupMember('Jordan');
    const booked = await alex.agent.post('/api/bookings').send({ professionalId: pro.user.id, startsAt: TUE_0900_SGT });
    const id = booked.body.booking.id;

    const list = await jordan.agent.get('/api/bookings');
    expect(list.body.upcoming).toEqual([]);
    expect((await jordan.agent.post(`/api/bookings/${id}/cancel`).send({})).status).toBe(404);
    expect(
      (await jordan.agent.post(`/api/bookings/${id}/reschedule`).send({ startsAt: '2030-01-08T02:00:00.000Z' })).status,
    ).toBe(404);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe('BOOKED');
  });

  it('professionals see only their own schedule, with member names', async () => {
    const proA = await signupPro('Asia/Singapore', '09:00', '17:00', 'Pro A');
    const proB = await signupPro('Asia/Singapore', '09:00', '17:00', 'Pro B');
    const alex = await signupMember('Alex');
    const booked = await alex.agent.post('/api/bookings').send({ professionalId: proA.user.id, startsAt: TUE_0900_SGT });

    const a = await proA.agent.get('/api/bookings');
    expect(a.body.upcoming).toHaveLength(1);
    expect(a.body.upcoming[0].member).toEqual({ id: alex.user.id, name: 'Alex' });

    const b = await proB.agent.get('/api/bookings');
    expect(b.body.upcoming).toEqual([]);
    expect((await proB.agent.post(`/api/bookings/${booked.body.booking.id}/cancel`).send({})).status).toBe(404);
  });
});
