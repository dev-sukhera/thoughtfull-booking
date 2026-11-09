import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ProfessionalSummary } from '../api';
import { tzLabel } from '../time';

export function ProfessionalsPage() {
  const [pros, setPros] = useState<ProfessionalSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ professionals: ProfessionalSummary[] }>('/professionals')
      .then((r) => setPros(r.professionals))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <h1>Find a professional</h1>
      {error && <p className="alert error">{error}</p>}
      {!pros && !error && <p className="muted">Loading…</p>}
      {pros?.length === 0 && <p className="muted">No professionals yet.</p>}
      <div className="grid">
        {pros?.map((p) => (
          <Link key={p.id} to={`/professionals/${p.id}`} className="card pro-card">
            <div className="avatar" aria-hidden>{p.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</div>
            <div>
              <h3>{p.name}</h3>
              {p.title && <div className="muted">{p.title}</div>}
              {p.bio && <p className="small">{p.bio}</p>}
              <div className="muted small">Based in {tzLabel(p.timezone)}</div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
