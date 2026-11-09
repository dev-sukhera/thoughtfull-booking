import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError, SessionsResponse, SessionView } from '../api';
import { useUser } from '../auth';
import { fmtDateTime, fmtRange } from '../time';

export function MySessionsPage() {
  const user = useUser();
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState<SessionsResponse | null>(null);
  const [flash, setFlash] = useState<string | null>((location.state as { flash?: string } | null)?.flash ?? null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.get<SessionsResponse>('/bookings').then(setData), []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  const cancel = async (s: SessionView) => {
    if (!window.confirm(`Cancel your session with ${s.professional.name} on ${fmtDateTime(s.startsAt, user.timezone)}?`)) return;
    setError(null);
    try {
      await api.post(`/bookings/${s.id}/cancel`);
      setFlash('Session cancelled.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not cancel');
    }
    await load();
  };

  if (!data) return error ? <p className="alert error">{error}</p> : <p className="muted">Loading…</p>;

  return (
    <>
      <h1>My sessions</h1>
      {flash && <p className="alert success">{flash}</p>}
      {error && <p className="alert error" role="alert">{error}</p>}

      <h2>Upcoming</h2>
      {data.upcoming.length === 0 && (
        <p className="muted">
          No upcoming sessions. <Link to="/professionals">Find a professional</Link>
        </p>
      )}
      <ul className="list">
        {data.upcoming.map((s) => (
          <li key={s.id} className="card session">
            <div>
              <strong>{fmtRange(s.startsAt, s.endsAt, user.timezone)}</strong>
              <div>
                with {s.professional.name}
                {s.professional.title && <span className="muted"> · {s.professional.title}</span>}
              </div>
              {s.canCancel ? (
                <div className="muted small">You can change this until {fmtDateTime(s.changeDeadline!, user.timezone)}.</div>
              ) : (
                <div className="notice small">
                  This session starts in less than 24 hours, so it can no longer be cancelled or rescheduled here.
                  Please contact {s.professional.name} if you need to change it.
                </div>
              )}
            </div>
            <div className="actions">
              <button
                className="btn secondary"
                disabled={!s.canReschedule}
                onClick={() =>
                  navigate(`/professionals/${s.professional.id}?reschedule=${s.id}&from=${encodeURIComponent(s.startsAt)}`)
                }
              >
                Reschedule
              </button>
              <button className="btn danger" disabled={!s.canCancel} onClick={() => cancel(s)}>Cancel</button>
            </div>
          </li>
        ))}
      </ul>

      <h2>Past</h2>
      {data.past.length === 0 && <p className="muted">No past sessions yet.</p>}
      <ul className="list">
        {data.past.map((s) => (
          <li key={s.id} className="card session past">
            <span>{fmtRange(s.startsAt, s.endsAt, user.timezone)}</span>
            <span className="muted">with {s.professional.name}</span>
          </li>
        ))}
      </ul>

      {data.cancelled.length > 0 && (
        <details>
          <summary className="muted">Cancelled ({data.cancelled.length})</summary>
          <ul className="list">
            {data.cancelled.map((s) => (
              <li key={s.id} className="card session past">
                <s>{fmtRange(s.startsAt, s.endsAt, user.timezone)}</s>
                <span className="muted">
                  with {s.professional.name} · cancelled by {s.cancelledByRole === 'MEMBER' ? 'you' : 'the professional'}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
