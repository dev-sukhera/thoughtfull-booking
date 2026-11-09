import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { api, Notification } from '../api';
import { tzLabel } from '../time';

export const NOTIFICATIONS_CHANGED = 'notifications-changed';

export function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = () =>
      api
        .get<{ notifications: Notification[]; unreadCount: number }>('/notifications')
        .then((r) => !cancelled && setUnread(r.unreadCount))
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 15_000);
    window.addEventListener(NOTIFICATIONS_CHANGED, load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_CHANGED, load);
    };
  }, [user]);

  return (
    <header className="nav">
      <Link to="/" className="brand">ThoughtFull</Link>
      {user && (
        <nav>
          {user.role === 'MEMBER' ? (
            <>
              <NavLink to="/professionals">Find a professional</NavLink>
              <NavLink to="/sessions">My sessions</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/schedule">My schedule</NavLink>
              <NavLink to="/availability">Availability</NavLink>
            </>
          )}
          <NavLink to="/notifications">
            Notifications{unread > 0 && <span className="badge" aria-label={`${unread} unread`}>{unread}</span>}
          </NavLink>
        </nav>
      )}
      <div className="nav-right">
        {user ? (
          <>
            <span className="muted small" title={user.timezone}>
              {user.name} · {tzLabel(user.timezone)}
            </span>
            <button
              className="btn-link"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <NavLink to="/login">Log in</NavLink>
            <NavLink to="/signup">Sign up</NavLink>
          </>
        )}
      </div>
    </header>
  );
}
