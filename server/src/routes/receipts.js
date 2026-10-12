import express, { Router } from 'express';
import { query } from '../db.js';
import { HttpError, idParam, wrap } from '../lib/http.js';
import { cleanFilename, detectType, RECEIPT_MAX_BYTES, RECEIPT_TYPES, RECEIPTS_PER_PAYMENT } from '../lib/images.js';
import { t } from '../lib/i18n.js';

/** Budget-scoped: list, upload and delete the receipts of a payment. */
const router = Router();
/** User-level: download one (an <img> or a link cannot send the budget header, so access is by membership of its budget). */
export const fileRouter = Router();

const META = 'id, transaction_id, filename, mime, size_bytes, created_at, uploaded_by';

async function ownTransaction(req) {
  const id = idParam(req);
  const { rows } = await query('SELECT id FROM transactions WHERE id = $1 AND workspace_id = $2', [id, req.workspace.id]);
  if (!rows[0]) throw new HttpError(404, t('Payment not found.'));
  return id;
}

router.get(
  '/transactions/:id/receipts',
  wrap(async (req, res) => {
    const id = await ownTransaction(req);
    const { rows } = await query(`SELECT ${META} FROM receipts WHERE transaction_id = $1 ORDER BY id`, [id]);
    res.json(rows);
  }),
);

router.post(
  '/transactions/:id/receipts',
  express.raw({ type: RECEIPT_TYPES, limit: RECEIPT_MAX_BYTES }),
  wrap(async (req, res) => {
    const txId = await ownTransaction(req);
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) throw new HttpError(415, t('Attach a JPEG, PNG, WebP image or a PDF.'));
    const mime = detectType(buf); // trust the bytes, not what the client claims
    if (!RECEIPT_TYPES.includes(mime)) throw new HttpError(415, t('That file is not a JPEG, PNG, WebP image or PDF.'));
    const { rows: count } = await query('SELECT count(*)::int AS n FROM receipts WHERE transaction_id = $1', [txId]);
    if (count[0].n >= RECEIPTS_PER_PAYMENT) throw new HttpError(409, t('A payment can have at most {RECEIPTS_PER_PAYMENT} receipts.', { RECEIPTS_PER_PAYMENT }));
    const filename = cleanFilename(req.headers['x-filename'], mime);
    const { rows } = await query(
      `INSERT INTO receipts (transaction_id, workspace_id, uploaded_by, filename, mime, size_bytes, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${META}`,
      [txId, req.workspace.id, req.user.id, filename, mime, buf.length, buf],
    );
    res.status(201).json(rows[0]);
  }),
);

router.delete(
  '/receipts/:id',
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM receipts WHERE id = $1 AND workspace_id = $2', [idParam(req), req.workspace.id]);
    if (!rowCount) throw new HttpError(404, t('Receipt not found.'));
    res.status(204).end();
  }),
);

fileRouter.get(
  '/receipts/:id',
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT r.filename, r.mime, r.data FROM receipts r
       WHERE r.id = $1 AND EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = r.workspace_id AND m.user_id = $2)`,
      [idParam(req), req.user.id],
    );
    const r = rows[0];
    if (!r) throw new HttpError(404, t('Receipt not found.'));
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    const headers = {
      'Content-Type': r.mime,
      'Content-Disposition': `${disposition}; filename="receipt"; filename*=UTF-8''${encodeURIComponent(r.filename)}`,
      'Cache-Control': 'private, max-age=3600',
      'Content-Length': String(r.data.length),
    };
    // images are shown in a locked-down sandbox; PDFs need the browser's own viewer, which a sandbox would block
    if (r.mime !== 'application/pdf') headers['Content-Security-Policy'] = "default-src 'none'; sandbox";
    res.set(headers);
    res.send(r.data);
  }),
);

export default router;
