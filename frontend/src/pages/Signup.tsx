import { FormEvent, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError, Role, User } from '../api';
import { useAuth } from '../auth';
import { allTimezones, browserTimezone } from '../time';

export function SignupPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const timezones = useMemo(allTimezones, []);
  const [form, setForm] = useState({
    role: 'MEMBER' as Role,
    name: '',
    email: '',
    password: '',
    timezone: browserTimezone(),
    title: '',
    bio: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: User }>('/auth/signup', form);
      setUser(r.user);
      navigate(r.user.role === 'PROFESSIONAL' ? '/availability' : '/professionals');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign up');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card narrow">
      <h1>Create an account</h1>
      <form onSubmit={submit} className="form">
        <fieldset className="role-picker">
          <legend>I am a…</legend>
          <label className={form.role === 'MEMBER' ? 'selected' : ''}>
            <input type="radio" name="role" value="MEMBER" checked={form.role === 'MEMBER'} onChange={set('role')} />
            Member <span className="muted small">looking for support</span>
          </label>
          <label className={form.role === 'PROFESSIONAL' ? 'selected' : ''}>
            <input type="radio" name="role" value="PROFESSIONAL" checked={form.role === 'PROFESSIONAL'} onChange={set('role')} />
            Professional <span className="muted small">counsellor, coach…</span>
          </label>
        </fieldset>
        <label>
          Name
          <input value={form.name} onChange={set('name')} required maxLength={100} />
        </label>
        <label>
          Email
          <input type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
        </label>
        <label>
          Password <span className="muted small">(at least 8 characters)</span>
          <input type="password" value={form.password} onChange={set('password')} required minLength={8} autoComplete="new-password" />
        </label>
        <label>
          Your timezone
          <select value={form.timezone} onChange={set('timezone')}>
            {timezones.map((tz) => (
              <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <span className="muted small">All times in the app are shown in this timezone.</span>
        </label>
        {form.role === 'PROFESSIONAL' && (
          <>
            <label>
              Title <span className="muted small">(optional)</span>
              <input value={form.title} onChange={set('title')} placeholder="e.g. Counselling Psychologist" maxLength={100} />
            </label>
            <label>
              Short bio <span className="muted small">(optional)</span>
              <textarea value={form.bio} onChange={set('bio')} rows={3} maxLength={1000} />
            </label>
          </>
        )}
        {error && <p className="alert error">{error}</p>}
        <button className="btn" disabled={busy}>{busy ? 'Creating account…' : 'Sign up'}</button>
      </form>
      <p className="muted small">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
