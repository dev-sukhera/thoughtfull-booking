import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, ProfessionalDetail, SlotsResponse } from '../api';
import { useUser } from '../auth';
import { Calendar } from '../components/Calendar';
import { fmtDateTime, fmtDayLong, fmtRange, fmtTime, tzLabel, WEEKDAYS } from '../time';

type Slot = SlotsResponse['days'][number]['slots'][number];

export function ProfessionalProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const rescheduleId = params.get('reschedule');
  const rescheduleFrom = params.get('from');
  const user = useUser();
  const navigate = useNavigate();

  const [pro, setPro] = useState<ProfessionalDetail | null>(null);
  const [slots, setSlots] = useState<SlotsResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [picked, setPicked] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSlots = useCallback(async () => {
    const r = await api.get<SlotsResponse>(`/professionals/${id}/slots`);
    setSlots(r);
    return r;
  }, [id]);

  useEffect(() => {
    api
      .get<{ professional: ProfessionalDetail }>(`/professionals/${id}`)
      .then((r) => setPro(r.professional))
      .catch((e) => setError(e.message));
    loadSlots()
      .then((r) => setSelectedDate((d) => d ?? r.days[0]?.date ?? null))
      .catch((e) => setError(e.message));
  }, [id, loadSlots]);

  const confirm = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      if (rescheduleId) {
        await api.post(`/bookings/${rescheduleId}/reschedule`, { startsAt: picked.startsAt });
      } else {
        await api.post('/bookings', { professionalId: id, startsAt: picked.startsAt });
      }
      navigate('/sessions', {
        state: { flash: `${rescheduleId ? 'Rescheduled to' : 'Booked:'} ${fmtDateTime(picked.startsAt, user.timezone)}` },
      });
    } catch (e) {
      setPicked(null);
      setError(e instanceof ApiError ? e.message : 'Booking failed, please try again');
      // The calendar may be stale (someone else booked first): refresh it.
      await loadSlots().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  if (!pro) return error ? <p className="alert error">{error}</p> : <p className="muted">Loading…</p>;

  const day = slots?.days.find((d) => d.date === selectedDate);

  return (
    <>
      <Link to="/professionals" className="small">← All professionals</Link>
      <section className="card profile">
        <h1>{pro.name}</h1>
        {pro.title && <div className="muted">{pro.title}</div>}
        {pro.bio && <p>{pro.bio}</p>}
        <div className="small muted">
          Works in {tzLabel(pro.timezone)}:{' '}
          {pro.weeklyHours.length === 0
            ? 'no hours set yet'
            : pro.weeklyHours.map((h) => `${WEEKDAYS[h.weekday - 1].slice(0, 3)} ${h.start}–${h.end}`).join(', ')}
        </div>
      </section>

      {rescheduleId && rescheduleFrom && (
        <p className="alert info">
          Rescheduling your session on <strong>{fmtDateTime(rescheduleFrom, user.timezone)}</strong>. Pick a new time
          below. Your current session stays booked until the new one is confirmed.
        </p>
      )}

      <h2>Pick a time</h2>
      <p className="muted small">
        Sessions are 50 minutes. Times are shown in <strong>your</strong> timezone: {tzLabel(user.timezone)}.
      </p>
      {error && <p className="alert error" role="alert">{error}</p>}

      {slots && (
        <div className="booking-layout">
          <Calendar
            data={slots}
            selectedDate={selectedDate}
            onSelectDate={(d) => {
              setSelectedDate(d);
              setPicked(null);
            }}
          />
          <div className="times card">
            {slots.days.length === 0 ? (
              <p className="muted">No free times in the next 4 weeks.</p>
            ) : !day ? (
              <p className="muted">Pick a day to see times.</p>
            ) : (
              <>
                <h3>{fmtDayLong(day.date)}</h3>
                <div className="time-buttons">
                  {day.slots.map((s) => (
                    <button
                      key={s.startsAt}
                      type="button"
                      className={`time${picked?.startsAt === s.startsAt ? ' selected' : ''}`}
                      onClick={() => setPicked(s)}
                    >
                      {s.localTime}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {picked && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="card modal">
            <h2 id="confirm-title">{rescheduleId ? 'Confirm new time' : 'Confirm your session'}</h2>
            <dl className="details">
              <dt>With</dt>
              <dd>{pro.name}</dd>
              {rescheduleId && rescheduleFrom && (
                <>
                  <dt>Moving from</dt>
                  <dd><s>{fmtDateTime(rescheduleFrom, user.timezone)}</s></dd>
                </>
              )}
              <dt>When (your time)</dt>
              <dd><strong>{fmtRange(picked.startsAt, picked.endsAt, user.timezone)}</strong></dd>
              {pro.timezone !== user.timezone && (
                <>
                  <dt>Their local time</dt>
                  <dd>{fmtTime(picked.startsAt, pro.timezone)} in {pro.timezone.replace(/_/g, ' ')}</dd>
                </>
              )}
              <dt>Length</dt>
              <dd>50 minutes</dd>
            </dl>
            <p className="muted small">
              You can cancel or reschedule up to 24 hours before the session starts. You'll get reminders 24 hours and
              1 hour before.
            </p>
            <div className="actions">
              <button className="btn secondary" onClick={() => setPicked(null)} disabled={busy}>Back</button>
              <button className="btn" onClick={confirm} disabled={busy}>
                {busy ? 'Saving…' : rescheduleId ? 'Confirm reschedule' : 'Book session'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
