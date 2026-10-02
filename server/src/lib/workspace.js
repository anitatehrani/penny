import { query } from '../db.js';
import { HttpError } from './http.js';

/**
 * Pick the budget (workspace) this request is about: the `X-Workspace` header (or `?ws=` for plain
 * links such as the CSV export), defaulting to the user's personal workspace. Membership is checked
 * on every request, so a user can never act on a workspace they do not belong to.
 */
export async function resolveWorkspace(req, _res, next) {
  try {
    const raw = req.headers['x-workspace'] ?? req.query.ws;
    let row;
    if (raw === undefined || raw === '') {
      row = (
        await query(
          `SELECT w.id, w.name, w.kind, m.role FROM workspaces w
           JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $1
           WHERE w.kind = 'personal' AND w.owner_id = $1`,
          [req.user.id],
        )
      ).rows[0];
    } else {
      const id = Number(raw);
      if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid workspace.');
      row = (
        await query(
          `SELECT w.id, w.name, w.kind, m.role FROM workspaces w
           JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $1
           WHERE w.id = $2`,
          [req.user.id, id],
        )
      ).rows[0];
      if (!row) throw new HttpError(403, 'You are not a member of that budget.');
    }
    if (!row) throw new HttpError(500, 'Your personal budget is missing.');
    req.workspace = row;
    next();
  } catch (err) {
    next(err);
  }
}

/** Reject a user id that is not a member of the workspace (null/undefined means "default"). */
export async function assertMember(workspaceId, userId) {
  const { rowCount } = await query('SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [
    workspaceId,
    userId,
  ]);
  if (!rowCount) throw new HttpError(400, 'That person is not a member of this budget.');
}
