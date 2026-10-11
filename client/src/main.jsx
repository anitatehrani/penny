import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import { installNumberWheelGuard } from './numberInputs.js';
import AuthPages from './pages/Auth.jsx';
import { ResetPassword, Unsubscribe, VerifyEmail } from './pages/EmailLinks.jsx';
import Contact from './pages/Contact.jsx';
import Landing from './pages/Landing.jsx';
import { Privacy, Terms } from './pages/Legal.jsx';
import './design/tokens.css';
import './styles.css';
import './auth.css';
import './social.css';
import './notifications.css';
import './design/base.css';
import './design/components.css';
import './design/calendar.css';
import './design/filters.css';
import './design/pages.css';
import './design/rows.css';
import './design/shell.css';
import './design/dashboard.css';
import './design/assistant.css';
import './design/admin.css';
import './design/legal.css';
import './design/landing.css';
import './design/import.css';
import './design/budget.css';
import './design/guides.css';

// fetched only after signing in (below)
const SignedIn = lazy(() => import('./SignedIn.jsx'));

function Root() {
  const { loading, user, error } = useAuth();
  const { pathname } = useLocation();
  // links from emails work whether or not you are signed in
  if (!loading && !error && pathname === '/verify-email') return <VerifyEmail />;
  if (!loading && !error && pathname === '/unsubscribe') return <Unsubscribe />;
  if (!loading && !error && pathname === '/reset-password') return <ResetPassword />;
  // the terms and the privacy policy are public: they must be readable before signing up
  if (!loading && !error && pathname === '/terms') return <Terms />;
  if (!loading && !error && pathname === '/privacy') return <Privacy />;
  if (!loading && !error && pathname === '/contact') return <Contact />;
  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="loading">Cannot reach the server: {error.message}</div>;
  // somebody who is not signed in sees the home page first; every other address goes to the sign-in pages
  if (!user) return pathname === '/' ? <Landing /> : <AuthPages />;
  // The app itself (every page, the assistant, the palette...) is a separate file that is fetched only after signing in, so a visitor to the home
  // page, who may be a search engine, downloads the home page and nothing more (docs/DESIGN.md section 44).
  return (
    <Suspense fallback={<div className="loading">Loading…</div>}>
      <SignedIn user={user} />
    </Suspense>
  );
}

installNumberWheelGuard(); // scrolling over a focused number box must not change the number

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
