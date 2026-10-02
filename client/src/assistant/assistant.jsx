import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import AssistantPanel from './AssistantPanel.jsx';

const Ctx = createContext({ open: false, openAssistant: () => {}, closeAssistant: () => {}, thread: [], ask: () => {}, clear: () => {} });
export const useAssistant = () => useContext(Ctx);

let counter = 0;

/**
 * The assistant as a place you can reach from anywhere: Ctrl/⌘ J, the "Ask" button, the command palette,
 * or the "Ask" link on an insight. It keeps the conversation while you move around the app.
 */
export function AssistantProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('overview');
  const [thread, setThread] = useState([]);
  const busy = useRef(false);

  const ask = useCallback(async (question) => {
    const q = question.trim();
    if (!q) return;
    const id = ++counter;
    setTab('chat');
    setThread((t) => [...t, { id, q, status: 'pending' }]);
    try {
      const a = await api.post('/assistant/ask', { question: q });
      setThread((t) => t.map((x) => (x.id === id ? { ...x, status: 'done', a } : x)));
    } catch (e) {
      setThread((t) => t.map((x) => (x.id === id ? { ...x, status: 'error', error: e.message } : x)));
    }
  }, []);

  const openAssistant = useCallback(
    (opts = {}) => {
      setOpen(true);
      if (opts.ask) ask(opts.ask);
      else if (opts.tab) setTab(opts.tab);
    },
    [ask],
  );
  const closeAssistant = useCallback(() => setOpen(false), []);
  const clear = useCallback(() => setThread([]), []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo(() => ({ open, openAssistant, closeAssistant, thread, ask, clear, tab, setTab, busy }), [open, openAssistant, closeAssistant, thread, ask, clear, tab]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {open && <AssistantPanel />}
    </Ctx.Provider>
  );
}
