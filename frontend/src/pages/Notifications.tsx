import { useCallback, useEffect, useState } from 'react';
import { api, Notification } from '../api';
import { useUser } from '../auth';
import { fmtDateTime } from '../time';
import { NOTIFICATIONS_CHANGED } from '../components/Nav';

export function NotificationsPage() {
  const user = useUser();
  const [items, setItems] = useState<Notification[] | null>(null);

  const load = useCallback(
    () => api.get<{ notifications: Notification[] }>('/notifications').then((r) => setItems(r.notifications)),
    [],
  );

  useEffect(() => {
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const markAll = async () => {
    await api.post('/notifications/read-all');
    await load();
    window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
  };

  const markOne = async (n: Notification) => {
    if (n.readAt) return;
    await api.post(`/notifications/${n.id}/read`);
    await load();
    window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
  };

  if (!items) return <p className="muted">Loading…</p>;
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <>
      <div className="title-row">
        <h1>Notifications</h1>
        {unread > 0 && <button className="btn secondary" onClick={markAll}>Mark all as read</button>}
      </div>
      {items.length === 0 && (
        <p className="muted">Nothing yet. Session reminders arrive here 24 hours and 1 hour before each session.</p>
      )}
      <ul className="list">
        {items.map((n) => (
          <li key={n.id} className={`card notification${n.readAt ? '' : ' unread'}`} onClick={() => markOne(n)}>
            <div className="title-row">
              <strong>{n.title}</strong>
              <span className="muted small">{fmtDateTime(n.createdAt, user.timezone)}</span>
            </div>
            <div>{n.body}</div>
          </li>
        ))}
      </ul>
    </>
  );
}
