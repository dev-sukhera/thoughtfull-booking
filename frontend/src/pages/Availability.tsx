import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useUser } from '../auth';
import { tzLabel, WEEKDAYS } from '../time';

interface DayRow {
  weekday: number;
  enabled: boolean;
  start: string;
  end: string;
}
interface Blocked {
  id: string;
  date: string;
  reason: string | null;
}

const defaultRows = (): DayRow[] =>
  WEEKDAYS.map((_, i) => ({ weekday: i + 1, enabled: false, start: '09:00', end: '17:00' }));

export function AvailabilityPage() {
  const user = useUser();
  const [rows, setRows] = useState<DayRow[]>(defaultRows);
  const [blocked, setBlocked] = useState<Blocked[]>([]);
  const [newDate, setNewDate] = useState('');
  const [newReason, setNewReason] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ days: Array<{ weekday: number; start: string; end: string }> }>('/me/availability').then((r) => {
      const next = defaultRows();
      for (const d of r.days) next[d.weekday - 1] = { ...d, end: d.end === '24:00' ? '23:59' : d.end, enabled: true };
      setRows(next);
    });
    api.get<{ blockedDates: Blocked[] }>('/me/blocked-dates').then((r) => setBlocked(r.blockedDates));
  }, []);

  const update = (i: number, patch: Partial<DayRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await api.put('/me/availability', {
        days: rows.filter((r) => r.enabled).map(({ weekday, start, end }) => ({ weekday, start, end })),
      });
      setMsg({ kind: 'success', text: 'Working hours saved. Existing bookings are not affected.' });
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not save' });
    } finally {
      setSaving(false);
    }
  };

  const addBlocked = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.post<{ blockedDate: Blocked }>('/me/blocked-dates', { date: newDate, reason: newReason || undefined });
      setBlocked([...blocked.filter((b) => b.date !== r.blockedDate.date), r.blockedDate].sort((a, b) => a.date.localeCompare(b.date)));
      setNewDate('');
      setNewReason('');
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not block date' });
    }
  };

  const removeBlocked = async (id: string) => {
    await api.del(`/me/blocked-dates/${id}`);
    setBlocked(blocked.filter((b) => b.id !== id));
  };

  return (
    <>
      <h1>Availability</h1>
      <p className="muted">
        Set your weekly working hours in your own timezone, <strong>{tzLabel(user.timezone)}</strong>. Members see these
        as 50-minute sessions starting on the hour from your start time (10 minutes between sessions), shown in their
        own timezone.
      </p>
      {msg && <p className={`alert ${msg.kind}`}>{msg.text}</p>}

      <form onSubmit={save} className="card">
        <h2>Weekly hours</h2>
        <table className="hours">
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.weekday} className={r.enabled ? '' : 'off'}>
                <td>
                  <label>
                    <input type="checkbox" checked={r.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />{' '}
                    {WEEKDAYS[i]}
                  </label>
                </td>
                <td>
                  <input type="time" value={r.start} disabled={!r.enabled} onChange={(e) => update(i, { start: e.target.value })} aria-label={`${WEEKDAYS[i]} start`} />
                </td>
                <td>to</td>
                <td>
                  <input type="time" value={r.end} disabled={!r.enabled} onChange={(e) => update(i, { end: e.target.value })} aria-label={`${WEEKDAYS[i]} end`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn" disabled={saving}>{saving ? 'Saving…' : 'Save hours'}</button>
      </form>

      <section className="card">
        <h2>Days off</h2>
        <p className="muted small">Block specific dates (holidays, leave). Existing bookings on that day stay booked.</p>
        <form onSubmit={addBlocked} className="inline-form">
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} required aria-label="Date to block" />
          <input placeholder="Reason (optional)" value={newReason} onChange={(e) => setNewReason(e.target.value)} maxLength={200} />
          <button className="btn secondary">Block date</button>
        </form>
        <ul className="list">
          {blocked.map((b) => (
            <li key={b.id} className="row">
              <span>{b.date}{b.reason && <span className="muted"> · {b.reason}</span>}</span>
              <button className="btn-link" onClick={() => removeBlocked(b.id)}>Remove</button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
