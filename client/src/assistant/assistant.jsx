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

  // `chip`: the question came from a button, whose answer is worked out exactly on the server; typed questions may go to the AI service (if it is on)
  const threadRef = useRef([]);
  threadRef.current = thread;
  const ask = useCallback(async (question, { chip = false } = {}) => {
    const q = question.trim();
    if (!q) return;
    const id = ++counter;
    // the last few answered turns, so "and last month?" makes sense to the AI service
    const history = threadRef.current
      .filter((x) => x.status === 'done')
      .slice(-3)
      .map((x) => ({ q: x.q, a: x.a.answer }));
    setTab('chat');
    setThread((tt) => [...tt, { id, q, status: 'pending' }]);
    try {
      const a = await api.post('/assistant/ask', { question: q, ...(chip ? { chip: true } : { history }) });
      setThread((tt) => tt.map((x) => (x.id === id ? { ...x, status: 'done', a } : x)));
    } catch (e) {
      setThread((tt) => tt.map((x) => (x.id === id ? { ...x, status: 'error', error: e.message } : x)));
    }
  }, []);

  const openAssistant = useCallback(
    (opts = {}) => {
      setOpen(true);
      if (opts.ask) ask(opts.ask, { chip: Boolean(opts.chip) });
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
