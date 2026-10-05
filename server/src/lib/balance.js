import { query } from '../db.js';

/** The balance today of a budget, in cents: the starting balance plus everything marked paid (income in, expenses out). */
export async function currentBalanceCents(workspaceId, client = { query }) {
  const settings = (await client.query('SELECT opening_balance FROM workspace_settings WHERE workspace_id = $1', [workspaceId])).rows[0];
  const net = (
    await client.query(
      `SELECT COALESCE(round(sum(CASE WHEN type = 'income' THEN amount ELSE -amount END) * 100), 0)::float8 AS cents
       FROM transactions WHERE workspace_id = $1 AND status = 'paid'`,
      [workspaceId],
    )
  ).rows[0];
  return Math.round(Number(settings?.opening_balance ?? 0) * 100) + Number(net.cents);
}
