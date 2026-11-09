import { useMemo } from 'react';
import { DateTime } from 'luxon';
import type { SlotDay, SlotsResponse } from '../api';

interface Props {
  data: SlotsResponse;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}

/**
 * Month-style grid of the booking window, laid out in the member's timezone.
 * Days come pre-grouped by the server in that timezone; this only draws them.
 */
export function Calendar({ data, selectedDate, onSelectDate }: Props) {
  const byDate = useMemo(() => new Map(data.days.map((d) => [d.date, d])), [data]);

  const cells = useMemo(() => {
    const today = DateTime.fromISO(data.generatedAt, { zone: data.timezone }).startOf('day');
    const last = today.plus({ days: data.windowDays });
    const start = today.minus({ days: today.weekday - 1 }); // back to Monday
    const out: Array<{ date: string; inWindow: boolean; day: SlotDay | undefined; label: DateTime }> = [];
    for (let d = start; d <= last || d.weekday !== 1; d = d.plus({ days: 1 })) {
      const iso = d.toISODate()!;
      out.push({ date: iso, inWindow: d >= today && d <= last, day: byDate.get(iso), label: d });
      if (out.length > 42) break;
    }
    return out;
  }, [data, byDate]);

  return (
    <div className="calendar" role="grid" aria-label="Available days">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
        <div key={d} className="cal-head">{d}</div>
      ))}
      {cells.map(({ date, inWindow, day, label }) => {
        const count = day?.slots.length ?? 0;
        const disabled = !inWindow || count === 0;
        return (
          <button
            key={date}
            type="button"
            className={`cal-day${selectedDate === date ? ' selected' : ''}${count > 0 && inWindow ? ' has-slots' : ''}`}
            disabled={disabled}
            onClick={() => onSelectDate(date)}
            aria-pressed={selectedDate === date}
            aria-label={`${label.toFormat('cccc d LLLL')}: ${count} available`}
          >
            <span className="cal-num">{label.day === 1 || date === cells[0].date ? label.toFormat('d LLL') : label.day}</span>
            {inWindow && <span className="cal-count">{count > 0 ? `${count} free` : '—'}</span>}
          </button>
        );
      })}
    </div>
  );
}
