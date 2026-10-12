import React, { Suspense, lazy, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import { splitLangPath, wantedLanguage } from './i18n/core.js';
import { I18nProvider, browserLanguage, rememberedLanguage, useLang } from './i18n/react.jsx';
import { installNumberWheelGuard } from './numberInputs.js';
import AuthPages from './pages/Auth.jsx';
import { ResetPassword, Unsubscribe, VerifyEmail } from './pages/EmailLinks.jsx';
import Contact from './pages/Contact.jsx';
import Landing from './pages/Landing.jsx';
import { Privacy, Terms } from './pages/Legal.jsx';
import { t } from './i18n/translate.js';
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
  const { pathname, search } = useLocation();
  const { lang, setLanguage } = useLang();
  // the public pages have an address per language (/it/terms); everything below works with the address without the language
  const { path: pathOnly, lang: pathLang } = splitLangPath(pathname);
  const wanted = wantedLanguage({ pathname, signedIn: !!user, saved: undefined, remembered: rememberedLanguage(), browser: browserLanguage() });
  const wrongLanguage = !loading && wanted !== lang;
  useEffect(() => {
    if (wrongLanguage) setLanguage(wanted, { save: false });
  }, [wrongLanguage, wanted, setLanguage]);
  if (wrongLanguage) return null; // the right language is on its way: never draw the wrong one first
  // links from emails work whether or not you are signed in
  if (!loading && !error && pathOnly === '/verify-email') return <VerifyEmail />;
  if (!loading && !error && pathOnly === '/unsubscribe') return <Unsubscribe />;
  if (!loading && !error && pathOnly === '/reset-password') return <ResetPassword />;
  // the terms and the privacy policy are public: they must be readable before signing up
  if (!loading && !error && pathOnly === '/terms') return <Terms />;
  if (!loading && !error && pathOnly === '/privacy') return <Privacy />;
  if (!loading && !error && pathOnly === '/contact') return <Contact />;
  if (loading) return <div className="loading">{t('Loading…')}</div>;
  if (error) return <div className="loading">{t('Cannot reach the server: {message}', { message: error.message })}</div>;
  // somebody who is not signed in sees the home page first; every other address goes to the sign-in pages
  if (!user) return pathOnly === '/' ? <Landing /> : <AuthPages />;
  // somebody signed in uses the app, which has no address per language: /it/payments is /payments
  if (pathLang) return <Navigate to={pathOnly + search} replace />;
  // The app itself (every page, the assistant, the palette...) is a separate file that is fetched only after signing in, so a visitor to the home
  // page, who may be a search engine, downloads the home page and nothing more (docs/DESIGN.md section 44).
  return (
    <Suspense fallback={<div className="loading">{t('Loading…')}</div>}>
      <SignedIn user={user} />
    </Suspense>
  );
}

installNumberWheelGuard(); // scrolling over a focused number box must not change the number

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <I18nProvider>
          <Root />
        </I18nProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
