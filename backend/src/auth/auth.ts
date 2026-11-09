import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/db';
import { clock } from '../lib/clock';
import { config } from '../config';
import { HttpError } from '../lib/errors';

export const SESSION_COOKIE = 'tf_session';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  timezone: string;
  title: string | null;
  bio: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const hashPassword = (password: string) => bcrypt.hash(password, 10);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

/** Only a SHA-256 of the token is stored, so a database leak does not leak live sessions. */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function startSession(res: Response, userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const ttlMs = config.sessionTtlDays * 24 * 60 * 60 * 1000;
  await prisma.authSession.create({
    data: { tokenHash: hashToken(token), userId, expiresAt: new Date(clock.now().getTime() + ttlMs) },
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // not readable from JavaScript
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: ttlMs,
    path: '/',
  });
}

export async function endSession(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string') {
    await prisma.authSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/**
 * Resolves the caller from the session cookie. The user's identity always comes
 * from here, never from an id in the request body or query.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || token.length === 0) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Please log in');
  }
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt <= clock.now()) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Your session has expired, please log in again');
  }
  const { id, email, name, role, timezone, title, bio } = session.user;
  req.user = { id, email, name, role, timezone, title, bio };
  next();
}

export function requireRole(role: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.user?.role !== role) {
      throw new HttpError(403, 'FORBIDDEN', `Only ${role.toLowerCase()}s can do this`);
    }
    next();
  };
}

/** Narrow `req.user` for handlers mounted behind requireAuth. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please log in');
  return req.user;
}
