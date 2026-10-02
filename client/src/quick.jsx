import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import TransactionForm from './components/TransactionForm.jsx';
import { Modal } from './components/ui.jsx';

const Ctx = createContext({ version: 0, bump: () => {}, openAddPayment: () => {} });
export const useQuick = () => useContext(Ctx);

/**
 * Things that can be started from anywhere (the command palette, the dashboard, the top bar).
 *  - `version` goes up whenever the ledger changed, so every widget that shows money can reload.
 *  - `openAddPayment()` opens the add-payment dialog on top of whatever page you are on.
 */
export function QuickProvider({ children }) {
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(null); // null | { defaultDate? }
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const openAddPayment = useCallback((opts = {}) => setAdding(opts), []);
  const value = useMemo(() => ({ version, bump, openAddPayment }), [version, bump, openAddPayment]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {adding && (
        <Modal title="Add payment" onClose={() => setAdding(null)}>
          <TransactionForm
            defaultDate={adding.defaultDate}
            onCancel={() => setAdding(null)}
            onSaved={() => {
              setAdding(null);
              bump();
            }}
          />
        </Modal>
      )}
    </Ctx.Provider>
  );
}
