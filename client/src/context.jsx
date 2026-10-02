import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { api } from './api.js';
import { useFetch } from './hooks.js';
import { makeMoney } from './format.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const settings = useFetch(() => api.get('/settings'), []);
  const categories = useFetch(() => api.get('/categories'), []);
  const [toasts, setToasts] = useState([]);

  // notify(message, 'ok' | 'error', { label, run }?)  A toast with an optional action button (e.g. Undo).
  const notify = useCallback((message, kind = 'ok', action) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-3), { id, message, kind, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : action ? 7000 : 3200);
  }, []);
  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const currency = settings.data?.currency ?? 'USD';
  const money = useMemo(() => makeMoney(currency), [currency]);

  const value = {
    ready: !!settings.data && !!categories.data,
    error: settings.error || categories.error,
    settings: settings.data,
    categories: categories.data ?? [],
    reloadSettings: settings.reload,
    reloadCategories: categories.reload,
    currency,
    money,
    notify,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span>{t.message}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  dismissToast(t.id);
                  t.action.run();
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
