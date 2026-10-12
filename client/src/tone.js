// Whether the person asked Penny to keep a straight face. The choice lives in their preferences (prefs.tone); this copy in localStorage is
// for the screens that appear before the preferences have loaded (the loading screen), so they can follow it from the first paint.
export const readPlain = () => {
  try {
    return localStorage.getItem('tone') === 'plain';
  } catch {
    return false;
  }
};
export const writeTone = (tone) => {
  try {
    localStorage.setItem('tone', tone === 'plain' ? 'plain' : 'cheeky');
  } catch {
    /* private mode: the choice lasts for this visit */
  }
};
