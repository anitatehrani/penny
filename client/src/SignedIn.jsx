import App from './App.jsx';
import { AssistantProvider } from './assistant/assistant.jsx';
import { InsightsProvider } from './assistant/insights.jsx';
import { CommandProvider } from './command/command.jsx';
import { AppProvider } from './context.jsx';
import { NotificationsProvider } from './notifications.jsx';
import { useEffect } from 'react';
import { useLang } from './i18n/react.jsx';
import { PreferencesProvider, usePrefs } from './prefs.jsx';
import { PresenceProvider } from './presence.jsx';
import { QuickProvider } from './quick.jsx';
import { useWorkspace, WorkspaceProvider } from './workspace.jsx';

/** The language saved in the account (it follows the person to another device) becomes the language shown. */
function LanguageFromPrefs() {
  const { prefs, setPrefs, ready } = usePrefs();
  const { lang, setLanguage } = useLang();
  useEffect(() => {
    if (prefs.language && prefs.language !== lang) setLanguage(prefs.language);
  }, [prefs.language, lang, setLanguage]);
  // no choice saved yet and a language other than English was picked for them (the browser's): keep it, so what the server writes (alerts, e-mails) matches the screen
  useEffect(() => {
    if (ready && !prefs.language && lang !== 'en') setPrefs({ language: lang });
  }, [ready, prefs.language, lang, setPrefs]);
  return null;
}

/** Re-mounts the data layer whenever the open budget changes, so every page reloads its own data. */
function Scoped() {
  const { current } = useWorkspace();
  return (
    <AppProvider key={current.id}>
      <QuickProvider>
        <InsightsProvider>
          <AssistantProvider>
            <CommandProvider>
              <App />
            </CommandProvider>
          </AssistantProvider>
        </InsightsProvider>
      </QuickProvider>
    </AppProvider>
  );
}

/**
 * Everything that exists only for a signed-in person. It lives in its own file so that it is loaded only then (see main.jsx): somebody who
 * is just reading the home page, the terms or the privacy policy never downloads it.
 */
export default function SignedIn({ user }) {
  // key = user id, so switching accounts always starts from clean state.
  return (
    <PreferencesProvider key={user.id}>
      <LanguageFromPrefs />
      <WorkspaceProvider>
        <PresenceProvider>
          <NotificationsProvider>
            <Scoped />
          </NotificationsProvider>
        </PresenceProvider>
      </WorkspaceProvider>
    </PreferencesProvider>
  );
}
