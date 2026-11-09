import { useCallback, useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { api, ApiError, SessionsResponse, SessionView } from '../api';
import { useUser } from '../auth';
import { fmtDateTime, fmtTime, inZone } from '../time';

export function SchedulePage() {
  const user = useUser();
  const [data, setData] = useState<SessionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => api.get<SessionsResponse>('/bookings').then(setData), []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  const cancel = async (s: SessionView) => {
    if (!window.confirm(`Cancel the session with ${s.member?.name} on ${fmtDateTime(s.startsAt, user.timezone)}? They will be notified.`)) return;
    setError(null);
    try {
      await api.post(`/bookings/${s.id}/cancel`);
      setFlash('Session cancelled. The member has been notified.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not cancel');
    }
    await load();
  };

  if (!data) return error ? <p className="alert error">{error}</p> : <p className="muted">Loading…</p>;

  // Group upcoming sessions by day in the professional's timezone.
  const groups = new Map<string, SessionView[]>();
  for (const s of data.upcoming) {
    const key = inZone(s.startsAt, user.timezone).toISODate()!;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  return (
    <>
      <h1>My schedule</h1>
      <p className="muted small">Times in your timezone: {user.timezone.replace(/_/g, ' ')}</p>
      {flash && <p className="alert success">{flash}</p>}
      {error && <p className="alert error" role="alert">{error}</p>}

      {data.upcoming.length === 0 && <p className="muted">No upcoming sessions.</p>}
      {[...groups.entries()].map(([date, sessions]) => (
        <section key={date}>
          <h3>{DateTime.fromISO(date).toFormat('cccc d LLLL yyyy')}</h3>
          <ul className="list">
            {sessions.map((s) => (
              <li key={s.id} className="card session">
                <div>
                  <strong>
                    {fmtTime(s.startsAt, user.timezone)}–{fmtTime(s.endsAt, user.timezone)}
                  </strong>{' '}
                  · {s.member?.name}
                </div>
                <button className="btn danger" disabled={!s.canCancel} onClick={() => cancel(s)}>Cancel</button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {data.past.length > 0 && (
        <details>
          <summary className="muted">Past sessions ({data.past.length})</summary>
          <ul className="list">
            {data.past.map((s) => (
              <li key={s.id} className="card session past">
                <span>{fmtDateTime(s.startsAt, user.timezone)}</span>
                <span className="muted">{s.member?.name}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
