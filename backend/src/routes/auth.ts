import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { currentUser, endSession, hashPassword, requireAuth, startSession, verifyPassword } from '../auth/auth';
import { HttpError } from '../lib/errors';
import { isValidTimezone } from '../lib/timezone';

export const authRouter = Router();

const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  name: z.string().trim().min(1).max(100),
  role: z.enum(['MEMBER', 'PROFESSIONAL']),
  timezone: z.string().refine(isValidTimezone, 'Unknown timezone'),
  title: z.string().trim().max(100).optional(),
  bio: z.string().trim().max(1000).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

authRouter.post('/signup', async (req, res) => {
  const input = signupSchema.parse(req.body);
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists');

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash: await hashPassword(input.password),
      name: input.name,
      role: input.role,
      timezone: input.timezone,
      title: input.role === 'PROFESSIONAL' ? input.title || null : null,
      bio: input.role === 'PROFESSIONAL' ? input.bio || null : null,
    },
  });
  await startSession(res, user.id);
  res.status(201).json({ user: publicUser(user) });
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  // Same message for unknown email and wrong password: don't reveal which accounts exist.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  await startSession(res, user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post('/logout', async (req, res) => {
  await endSession(req, res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: currentUser(req) });
});

function publicUser(u: { id: string; email: string; name: string; role: string; timezone: string; title: string | null; bio: string | null }) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, timezone: u.timezone, title: u.title, bio: u.bio };
}
