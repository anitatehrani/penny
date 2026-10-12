import { query } from '../db.js';
import { t } from './i18n.js';

/**
 * Everything Penny holds about one person, as plain data they can keep (docs/DESIGN.md section 36).
 *
 * It is their profile and settings, the budgets they are a member of with what is in them, what was said to them, what they wrote through the contact form, and what the activity log
 * says about them. Never a password hash, a session, or the bytes of a photo or a receipt (receipts are listed, not included).
 * For a shared budget it holds that budget's content, which the person can already see, and the other members' names and usernames
 * only, not their e-mail addresses or anything else about them.
 */
export async function buildExport(userId, db = { query }) {
  const q = async (sql, params = [userId]) => (await db.query(sql, params)).rows;

  const [profile] = await q(
    `SELECT id, name, email, username, phone, created_at, last_login_at, last_seen_at, email_verified_at, terms_accepted_at, terms_version,
            discoverable, find_by_email, find_by_phone, show_status, avatar_url,
            (password_hash IS NOT NULL) AS has_password, (google_id IS NOT NULL) AS google_connected, is_admin
     FROM users WHERE id = $1`,
  );

  const workspaces = await q(
    `SELECT w.id, w.name, w.kind, m.role, m.joined_at, w.owner_id = $1 AS owned_by_you, s.currency, s.opening_balance
     FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id LEFT JOIN workspace_settings s ON s.workspace_id = w.id
     WHERE m.user_id = $1 ORDER BY w.id`,
  );
  const ids = workspaces.map((w) => w.id);
  const inBudgets = (table, extra = '') => q(`SELECT * FROM ${table} WHERE workspace_id = ANY($1) ${extra}`, [ids]);

  const budgets = [];
  const [categories, transactions, recurring, installments, debts, receipts, members, participants, importRules, importBatches, monthlyBudgets] = await Promise.all([
    inBudgets('categories', 'ORDER BY id'),
    inBudgets('transactions', 'ORDER BY date, id'),
    inBudgets('recurring_rules', 'ORDER BY id'),
    inBudgets('installment_plans', 'ORDER BY id'),
    inBudgets('debts', 'ORDER BY id'),
    q(`SELECT id, transaction_id, workspace_id, filename, mime, size_bytes, created_at FROM receipts WHERE workspace_id = ANY($1) ORDER BY id`, [ids]),
    q(
      `SELECT m.workspace_id, u.name, u.username, m.role FROM workspace_members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ANY($1) ORDER BY m.workspace_id, m.joined_at`,
      [ids],
    ),
    q(
      `SELECT p.transaction_id, p.share, p.created_at FROM transaction_participants p JOIN transactions t ON t.id = p.transaction_id
       WHERE p.user_id = $1 ORDER BY p.transaction_id`,
    ),
    q('SELECT r.workspace_id, r.merchant_key, r.kind, c.name AS category, r.hits, r.created_at, r.updated_at FROM import_rules r JOIN categories c ON c.id = r.category_id WHERE r.workspace_id = ANY($1) ORDER BY r.id', [ids]),
    q('SELECT workspace_id, id, created_at, kind, added, total_in, total_out, first_date, last_date FROM import_batches WHERE workspace_id = ANY($1) ORDER BY id', [ids]),
    q('SELECT b.workspace_id, c.name AS category, b.month AS from_month, b.amount FROM category_budgets b JOIN categories c ON c.id = b.category_id WHERE b.workspace_id = ANY($1) ORDER BY b.workspace_id, c.name, b.month', [ids]),
  ]);
  for (const w of workspaces) {
    const of = (rows) => rows.filter((r) => r.workspace_id === w.id);
    budgets.push({
      ...w,
      members: of(members).map(({ name, username, role }) => ({ name, username, role })),
      categories: of(categories),
      transactions: of(transactions),
      recurring: of(recurring),
      installment_plans: of(installments),
      debts: of(debts),
      receipts: of(receipts),
      monthly_budget: of(monthlyBudgets).map(({ workspace_id, ...rest }) => rest),
      what_penny_learned_from_imports: of(importRules).map(({ workspace_id, ...rest }) => rest),
      bank_statement_imports: of(importBatches).map(({ workspace_id, ...rest }) => rest),
    });
  }

  const [notificationSettings] = await q('SELECT * FROM notification_settings WHERE user_id = $1');
  const [preferences] = await q('SELECT data, updated_at FROM user_preferences WHERE user_id = $1');
  const [oldSettings] = await q('SELECT opening_balance, currency FROM user_settings WHERE user_id = $1');

  return {
    about: t('Everything Penny holds about you. Photos and receipt files are not included (the receipts are listed).'),
    exported_at: new Date().toISOString(),
    profile,
    settings: { account: oldSettings ?? null, notifications: notificationSettings ?? null, preferences: preferences ?? null },
    budgets,
    shared_payments_you_take_part_in: participants,
    connections: await q(
      `SELECT c.relation, c.status, c.created_at, c.responded_at, (c.requester_id = $1) AS you_asked, o.name AS other_name, o.username AS other_username
       FROM connections c JOIN users o ON o.id = CASE WHEN c.requester_id = $1 THEN c.addressee_id ELSE c.requester_id END
       WHERE c.requester_id = $1 OR c.addressee_id = $1 ORDER BY c.id`,
    ),
    alert_rules: await q('SELECT * FROM alert_overrides WHERE user_id = $1'),
    dismissed_insights: await q('SELECT workspace_id, insight_key FROM insight_dismissals WHERE user_id = $1'),
    notifications: await q('SELECT kind, title, body, link, created_at, read_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1000'),
    e_mails_sent_to_you: await q('SELECT to_email, subject, kind, status, created_at FROM email_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1000'),
    messages_you_sent_through_the_contact_form: await q('SELECT created_at, topic, name, email, message FROM contact_messages WHERE user_id = $1 ORDER BY created_at DESC'),
    replies_to_those_messages: await q(`SELECT r.created_at, r.direction, r.body FROM contact_replies r JOIN contact_messages m ON m.id = r.message_id WHERE m.user_id = $1 ORDER BY r.created_at, r.id`),
    activity_log: await q(`SELECT at, kind, detail FROM audit_events WHERE user_id = $1 ORDER BY at DESC LIMIT 1000`),
  };
}
