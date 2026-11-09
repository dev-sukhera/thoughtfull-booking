import express, { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { ZodError } from 'zod';
import { HttpError } from './lib/errors';
import { requireAuth } from './auth/auth';
import { authRouter } from './routes/auth';
import { professionalsRouter } from './routes/professionals';
import { meRouter } from './routes/me';
import { bookingsRouter } from './routes/bookings';
import { notificationsRouter } from './routes/notifications';

/**
 * Cheap CSRF defence on top of SameSite=Lax cookies: state-changing requests
 * must be JSON. A cross-site HTML form cannot send application/json, and a
 * cross-site fetch with that type needs a CORS preflight, which we never allow.
 */
function requireJsonForWrites(req: Request, _res: Response, next: NextFunction) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
    throw new HttpError(415, 'JSON_REQUIRED', 'Requests must use Content-Type: application/json');
  }
  next();
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '50kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api', requireJsonForWrites);
  app.use('/api/auth', authRouter);
  app.use('/api/professionals', requireAuth, professionalsRouter);
  app.use('/api/me', requireAuth, meRouter);
  app.use('/api/bookings', requireAuth, bookingsRouter);
  app.use('/api/notifications', requireAuth, notificationsRouter);

  app.use((_req, _res) => {
    throw new HttpError(404, 'NOT_FOUND', 'Not found');
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const where = first?.path.length ? `${first.path.join('.')}: ` : '';
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: `${where}${first?.message ?? 'Invalid input'}`, issues: err.issues },
      });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
  });

  return app;
}
