import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { clock } from '../lib/clock';
import { currentUser } from '../auth/auth';
import { notFound } from '../lib/errors';

export const notificationsRouter = Router();

notificationsRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, type: true, title: true, body: true, bookingId: true, createdAt: true, readAt: true },
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  res.json({ notifications, unreadCount });
});

notificationsRouter.post('/read-all', async (req, res) => {
  const user = currentUser(req);
  await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: clock.now() } });
  res.status(204).end();
});

notificationsRouter.post('/:id/read', async (req, res) => {
  const user = currentUser(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { count } = await prisma.notification.updateMany({
    where: { id, userId: user.id, readAt: null },
    data: { readAt: clock.now() },
  });
  if (count === 0) {
    const exists = await prisma.notification.count({ where: { id, userId: user.id } });
    if (!exists) throw notFound('Notification');
  }
  res.status(204).end();
});
