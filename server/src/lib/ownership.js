import { query } from '../db.js';
import { HttpError } from './http.js';
import { t } from './i18n.js';

/** Reject a category id that does not belong to this workspace (null/undefined means "no category"). */
export async function assertOwnCategory(workspaceId, categoryId) {
  if (categoryId == null) return;
  const { rowCount } = await query('SELECT 1 FROM categories WHERE id = $1 AND workspace_id = $2', [categoryId, workspaceId]);
  if (!rowCount) throw new HttpError(400, t('Unknown category.'));
}
