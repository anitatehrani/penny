import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { ErrorState } from './components/ds/States.jsx';
import { Loading } from './components/ui.jsx';
import DashboardPage from './dashboard/DashboardPage.jsx';
import DashboardLayout from './layout/DashboardLayout.jsx';
import { useApp } from './context.jsx';
import Admin from './pages/Admin.jsx';
import Forecast from './pages/Forecast.jsx';
import Debts from './pages/Debts.jsx';
import Installments from './pages/Installments.jsx';
import Notifications from './pages/Notifications.jsx';
import People from './pages/People.jsx';
import Profile from './pages/Profile.jsx';
import PublicProfile from './pages/PublicProfile.jsx';
import Budget from './pages/Budget.jsx';
import Recurring from './pages/Recurring.jsx';
import Settings from './pages/Settings.jsx';
import Transactions from './pages/Transactions.jsx';

export default function App() {
  const { ready, error } = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  // After signing in from a shared profile link, continue to that profile.
  useEffect(() => {
    try {
      const next = sessionStorage.getItem('next');
      if (next) {
        sessionStorage.removeItem('next');
        navigate(next, { replace: true });
      }
    } catch {
      /* ignore */
    }
  }, [navigate]);

  return (
    <DashboardLayout>
      {error ? (
        <ErrorState error={error} title="Cannot reach the server" onRetry={() => window.location.reload()} />
      ) : !ready ? (
        <Loading />
      ) : (
        <ErrorBoundary key={location.pathname}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/payments" element={<Transactions />} />
            <Route path="/budget" element={<Budget />} />
            <Route path="/recurring" element={<Recurring />} />
            <Route path="/installments" element={<Installments />} />
            <Route path="/debts" element={<Debts />} />
            <Route path="/forecast" element={<Forecast />} />
            <Route path="/people" element={<People />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/u/:username" element={<PublicProfile />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
      )}
    </DashboardLayout>
  );
}
