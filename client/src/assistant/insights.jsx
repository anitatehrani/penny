import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { useQuick } from '../quick.jsx';

const Ctx = createContext({ data: null, loading: true, error: null, insights: [], reload: () => {}, dismiss: () => {}, restoreAll: () => {}, overdueCount: 0, hasForecastWarning: false });
export const useInsights = () => useContext(Ctx);

/**
 * The assistant's view of the open budget: insights, month summary and the comparison numbers behind the charts.
 * Loaded once and shared by the dashboard, the assistant panel and the sidebar badges; reloads whenever the ledger changes.
 */
export function InsightsProvider({ children }) {
  const { notify } = useApp();
  const { version } = useQuick();
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const data = await api.get('/insights');
      if (mine === seq.current) setState({ data, loading: false, error: null });
    } catch (error) {
      if (mine === seq.current) setState((s) => ({ ...s, loading: false, error }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, version]);

  // dismiss with a way back: the card disappears at once, the toast offers Undo
  const dismiss = useCallback(
    async (insight) => {
      setState((s) => (s.data ? { ...s, data: { ...s.data, insights: s.data.insights.filter((i) => i.key !== insight.key), dismissed: s.data.dismissed + 1 } } : s));
      try {
        await api.post(`/insights/${encodeURIComponent(insight.key)}/dismiss`);
        notify('Insight dismissed. It stays hidden for the rest of the month.', 'ok', {
          label: 'Undo',
          run: async () => {
            await api.del(`/insights/${encodeURIComponent(insight.key)}/dismiss`).catch(() => {});
            load();
          },
        });
      } catch (e) {
        notify(e.message, 'error');
        load();
      }
    },
    [load, notify],
  );

  const restoreAll = useCallback(async () => {
    await api.del('/insights/dismissed').catch(() => {});
    load();
  }, [load]);

  const value = useMemo(() => {
    const insights = state.data?.insights ?? [];
    return {
      ...state,
      insights,
      reload: load,
      dismiss,
      restoreAll,
      overdueCount: state.data?.overdue?.count ?? 0,
      hasForecastWarning: insights.some((i) => i.type === 'forecast-negative' || i.type === 'below-zero') || !!state.data?.balance?.firstNegative,
    };
  }, [state, load, dismiss, restoreAll]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
