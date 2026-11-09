export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'UNKNOWN', data?.error?.message ?? 'Something went wrong');
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export type Role = 'MEMBER' | 'PROFESSIONAL';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  timezone: string;
  title: string | null;
  bio: string | null;
}

export interface ProfessionalSummary {
  id: string;
  name: string;
  title: string | null;
  bio: string | null;
  timezone: string;
}

export interface ProfessionalDetail extends ProfessionalSummary {
  weeklyHours: Array<{ weekday: number; start: string; end: string }>;
}

export interface SlotDay {
  date: string;
  slots: Array<{ startsAt: string; endsAt: string; localTime: string }>;
}

export interface SlotsResponse {
  timezone: string;
  sessionMinutes: number;
  windowDays: number;
  generatedAt: string;
  days: SlotDay[];
}

export interface SessionView {
  id: string;
  startsAt: string;
  endsAt: string;
  status: 'BOOKED' | 'CANCELLED';
  cancelledByRole: Role | null;
  professional: { id: string; name: string; title: string | null; timezone: string };
  member?: { id: string; name: string };
  canCancel: boolean;
  canReschedule: boolean;
  changeDeadline: string | null;
}

export interface SessionsResponse {
  upcoming: SessionView[];
  past: SessionView[];
  cancelled: SessionView[];
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  bookingId: string | null;
  createdAt: string;
  readAt: string | null;
}
