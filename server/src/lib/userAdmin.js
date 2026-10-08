import { query, withTransaction } from '../db.js';

/** In how many shared budgets is this person together with at least one other person? (Alone in a shared budget does not count.) */
export async function sharedBudgetCount(userId, db = { query }) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n
     FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
     WHERE m.user_id = $1 AND w.kind = 'group'
       AND EXISTS (SELECT 1 FROM workspace_members o WHERE o.workspace_id = m.workspace_id AND o.user_id <> $1)`,
    [userId],
  );
  return rows[0].n;
}

/**
 * Delete a person and everything only they own (docs/DESIGN.md section 33). The caller has already checked that they are in no shared budget with
 * other people, since their payments there, and a budget they own, would be taken away from those people.
 *
 * Their own budgets go first, in a step of their own: deleting a person and a budget that holds debts in one statement trips a foreign-key
 * check on the debts (their "who is it in the name of" link is being cleared in a budget that is already gone).
 */
export function deleteUserAccount(userId) {
  return withTransaction(async (client) => {
    await client.query('DELETE FROM workspaces WHERE owner_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
  });
}
