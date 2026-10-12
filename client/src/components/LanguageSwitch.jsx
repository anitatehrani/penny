import { Link, useLocation } from 'react-router-dom';
import { LANGUAGES, isPublicPath, splitLangPath, withLang } from '../i18n/core.js';
import { remember, useLang } from '../i18n/react.jsx';
import { t } from '../i18n/translate.js';
import { usePrefs } from '../prefs.jsx';
import { Tooltip } from './ds/Tooltip.jsx';
import { Icon, Segmented } from './ui.jsx';

/** The language choice for somebody signed in (Settings): saved in the account, so it follows them to another device. */
export function LanguagePicker() {
  const { prefs, setPrefs } = usePrefs();
  const { lang } = useLang();
  return <Segmented label={t('Language')} value={prefs.language ?? lang} onChange={(language) => setPrefs({ language })} options={LANGUAGES.map((l) => ({ value: l.code, label: l.name }))} />;
}

/**
 * The language links for somebody who is not signed in. On the public pages each language has its own address (/it/terms), so the link goes
 * there; on any other page the choice is only remembered. The names are always written in their own language.
 */
export function LanguageLinks({ className = '' }) {
  const { pathname, search } = useLocation();
  const { lang, setLanguage } = useLang();
  const { path } = splitLangPath(pathname);
  return (
    <nav className={`lang-links ${className}`.trim()} aria-label={t('Language')}>
      {LANGUAGES.map((l) =>
        isPublicPath(path) ? (
          <Link key={l.code} to={withLang(path, l.code) + search} onClick={() => remember(l.code)} lang={l.code} hrefLang={l.code} aria-current={l.code === lang ? 'true' : undefined} className={l.code === lang ? 'on' : ''}>
            {l.name}
          </Link>
        ) : (
          <button key={l.code} type="button" lang={l.code} aria-current={l.code === lang ? 'true' : undefined} className={`link-quiet${l.code === lang ? ' on' : ''}`} onClick={() => setLanguage(l.code)}>
            {l.name}
          </button>
        ),
      )}
    </nav>
  );
}

/**
 * One click in the top bar, in every signed-in page: the button names the language it switches to ("IT" while the app is in English), in that
 * language. The choice is saved in the account like the one in Settings. With a third language this becomes a small menu.
 */
export function LanguageQuick() {
  const { prefs, setPrefs } = usePrefs();
  const { lang } = useLang();
  const next = LANGUAGES.find((l) => l.code !== (prefs.language ?? lang)) ?? LANGUAGES[0];
  return (
    <Tooltip label={next.switchTo} side="bottom">
      <button type="button" className="lang-quick" lang={next.code} aria-label={next.switchTo} onClick={() => setPrefs({ language: next.code })}>
        <Icon name="globe" size={16} />
        <span>{next.code.toUpperCase()}</span>
      </button>
    </Tooltip>
  );
}
