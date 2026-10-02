import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { formatBytes, prepareReceipt, RECEIPT_TYPES, RECEIPTS_PER_PAYMENT } from '../images.js';
import { Icon, Modal } from './ui.jsx';

const fileUrl = (id, download) => `/api/receipts/${id}${download ? '?download=1' : ''}`;

function Thumb({ r }) {
  const [broken, setBroken] = useState(false);
  if (r.mime === 'application/pdf' || broken) {
    return (
      <span className="receipt-thumb file" aria-hidden="true">
        <Icon name="file" size={22} />
        <small>{r.mime === 'application/pdf' ? 'PDF' : 'File'}</small>
      </span>
    );
  }
  return <img className="receipt-thumb" src={fileUrl(r.id)} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

/**
 * Receipt list + attach button. Two modes:
 *  - `txId` set: files are uploaded straight away to that payment.
 *  - no `txId` (a new payment): files wait in `queue` until the payment is saved.
 */
export default function Receipts({ txId, items = [], onChange, queue = [], setQueue, readOnly }) {
  const { notify } = useApp();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const queued = !txId;
  const count = queued ? queue.length : items.length;
  const full = count >= RECEIPTS_PER_PAYMENT;

  async function add(e) {
    const files = [...(e.target.files ?? [])];
    e.target.value = ''; // picking the same file again should still fire
    if (!files.length) return;
    setBusy(true);
    setError(null);
    const problems = [];
    let room = RECEIPTS_PER_PAYMENT - count;
    for (const file of files) {
      if (room <= 0) {
        problems.push(`Only ${RECEIPTS_PER_PAYMENT} receipts fit on one payment.`);
        break;
      }
      try {
        const ready = await prepareReceipt(file);
        if (queued) setQueue((q) => [...q, { key: Math.random().toString(36).slice(2), file: ready, name: ready.name }]);
        else await api.upload('POST', `/transactions/${txId}/receipts`, ready, { 'X-Filename': encodeURIComponent(ready.name) });
        room -= 1;
      } catch (err) {
        problems.push(err.message);
      }
    }
    if (!queued) onChange?.();
    if (problems.length) setError(problems.join(' '));
    setBusy(false);
  }

  async function remove(r) {
    if (!window.confirm(`Remove the receipt “${r.filename}”?`)) return;
    try {
      await api.del(`/receipts/${r.id}`);
      notify('Receipt removed');
      onChange?.();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="receipts">
      {!queued && items.length > 0 && (
        <ul className="receipt-list">
          {items.map((r) => (
            <li key={r.id}>
              <a href={fileUrl(r.id)} target="_blank" rel="noreferrer" className="receipt-open" aria-label={`Open receipt ${r.filename}`}>
                <Thumb r={r} />
              </a>
              <div className="receipt-info">
                <a href={fileUrl(r.id)} target="_blank" rel="noreferrer">
                  {r.filename}
                </a>
                <span className="muted small">{formatBytes(r.size_bytes)}</span>
              </div>
              <a className="btn icon ghost" href={fileUrl(r.id, true)} aria-label={`Download ${r.filename}`} title="Download">
                <Icon name="download" size={16} />
              </a>
              {!readOnly && (
                <button type="button" className="btn icon ghost danger-hover" onClick={() => remove(r)} aria-label={`Remove ${r.filename}`} title="Remove">
                  <Icon name="trash" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {queued && queue.length > 0 && (
        <ul className="receipt-list">
          {queue.map((q) => (
            <li key={q.key}>
              <span className="receipt-thumb file" aria-hidden="true">
                <Icon name={q.file.type === 'application/pdf' ? 'file' : 'image'} size={22} />
              </span>
              <div className="receipt-info">
                <span>{q.name}</span>
                <span className="muted small">{formatBytes(q.file.size)} · uploads when you save</span>
              </div>
              <button type="button" className="btn icon ghost danger-hover" onClick={() => setQueue((list) => list.filter((x) => x.key !== q.key))} aria-label={`Remove ${q.name}`}>
                <Icon name="x" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!queued && items.length === 0 && <p className="muted small">No receipts attached yet.</p>}
      {!readOnly && (
        <div className="receipt-add">
          <input ref={input} type="file" multiple accept={RECEIPT_TYPES.join(',')} hidden onChange={add} aria-label="Choose receipt files" data-testid="receipt-input" />
          <button type="button" className="btn sm" disabled={busy || full} onClick={() => input.current.click()}>
            <Icon name="paperclip" size={16} /> {busy ? 'Adding…' : 'Attach receipt'}
          </button>
          <span className="field-hint">{full ? `Limit of ${RECEIPTS_PER_PAYMENT} reached.` : `Photo or PDF, up to 5 MB each (max ${RECEIPTS_PER_PAYMENT}).`}</span>
        </div>
      )}
      {error && (
        <p className="field-hint err-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function useReceiptList(txId) {
  const [data, setData] = useState(txId ? null : []);
  useEffect(() => {
    if (!txId) return undefined; // a payment that does not exist yet has nothing to list
    let alive = true;
    api
      .get(`/transactions/${txId}/receipts`)
      .then((r) => alive && setData(r))
      .catch(() => alive && setData([]));
    return () => {
      alive = false;
    };
  }, [txId]);
  return [data, setData];
}

/** Dialog opened from the paperclip on a payment row. */
export function ReceiptsModal({ tx, onClose, onChange }) {
  const [data, setData] = useReceiptList(tx.id);
  return (
    <Modal title={`Receipts · ${tx.description}`} onClose={onClose}>
      <div className="modal-body">
        {data === null ? (
          <p className="muted">Loading…</p>
        ) : (
          <Receipts
            txId={tx.id}
            items={data}
            onChange={async () => {
              setData(await api.get(`/transactions/${tx.id}/receipts`));
              onChange?.();
            }}
          />
        )}
      </div>
    </Modal>
  );
}

/** Upload the files queued while creating a payment. Returns how many failed. */
export async function uploadQueued(txId, queue) {
  let failed = 0;
  for (const q of queue) {
    try {
      await api.upload('POST', `/transactions/${txId}/receipts`, q.file, { 'X-Filename': encodeURIComponent(q.name) });
    } catch {
      failed += 1;
    }
  }
  return failed;
}

export { useReceiptList };
