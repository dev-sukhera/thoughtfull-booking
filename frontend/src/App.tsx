import { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import type { Role } from './api';
import { Nav } from './components/Nav';
import { LoginPage } from './pages/Login';
import { SignupPage } from './pages/Signup';
import { ProfessionalsPage } from './pages/Professionals';
import { ProfessionalProfilePage } from './pages/ProfessionalProfile';
import { MySessionsPage } from './pages/MySessions';
import { SchedulePage } from './pages/Schedule';
import { AvailabilityPage } from './pages/Availability';
import { NotificationsPage } from './pages/Notifications';

function RequireRole({ role, children }: { role?: Role; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Home() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'MEMBER' ? '/professionals' : '/schedule'} replace />;
}

export function App() {
  const { loading } = useAuth();
  if (loading) return <div className="page muted">Loading…</div>;
  return (
    <>
      <Nav />
      <main className="page">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/professionals" element={<RequireRole role="MEMBER"><ProfessionalsPage /></RequireRole>} />
          <Route path="/professionals/:id" element={<RequireRole role="MEMBER"><ProfessionalProfilePage /></RequireRole>} />
          <Route path="/sessions" element={<RequireRole role="MEMBER"><MySessionsPage /></RequireRole>} />
          <Route path="/schedule" element={<RequireRole role="PROFESSIONAL"><SchedulePage /></RequireRole>} />
          <Route path="/availability" element={<RequireRole role="PROFESSIONAL"><AvailabilityPage /></RequireRole>} />
          <Route path="/notifications" element={<RequireRole><NotificationsPage /></RequireRole>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
