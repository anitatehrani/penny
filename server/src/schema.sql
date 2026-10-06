-- ---------- accounts ----------
CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,
  email         text NOT NULL,
  name          text NOT NULL,
  password_hash text,                      -- NULL for accounts that only use Google
  google_id     text UNIQUE,
  avatar_url    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email));

-- Server-side sessions: only a SHA-256 hash of the cookie token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  user_agent text
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id         integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  currency        text NOT NULL DEFAULT 'USD'
);

-- Legacy single-user settings (from before accounts existed). Copied to the first account.
CREATE TABLE IF NOT EXISTS settings (
  id              integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  currency        text NOT NULL DEFAULT 'USD'
);
INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ---------- budget data (every row belongs to a user) ----------
CREATE TABLE IF NOT EXISTS categories (
  id         serial PRIMARY KEY,
  user_id    integer REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('income', 'expense')),
  color      text NOT NULL DEFAULT '#6b7280',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS user_id integer REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_kind_key;
-- Superseded by the per-workspace index at the bottom (group categories are created by different users).
DROP INDEX IF EXISTS categories_user_name_kind_uq;

CREATE TABLE IF NOT EXISTS recurring_rules (
  id             serial PRIMARY KEY,
  user_id        integer REFERENCES users(id) ON DELETE CASCADE,
  type           text NOT NULL CHECK (type IN ('income', 'expense')),
  description    text NOT NULL,
  amount         numeric(12,2) NOT NULL CHECK (amount > 0),
  category_id    integer REFERENCES categories(id) ON DELETE SET NULL,
  frequency      text NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'yearly')),
  interval_count integer NOT NULL DEFAULT 1 CHECK (interval_count >= 1),
  start_date     date NOT NULL,
  end_date       date,
  note           text,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE recurring_rules ADD COLUMN IF NOT EXISTS user_id integer REFERENCES users(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS installment_plans (
  id                serial PRIMARY KEY,
  user_id           integer REFERENCES users(id) ON DELETE CASCADE,
  description       text NOT NULL,
  total_amount      numeric(12,2) NOT NULL CHECK (total_amount > 0),
  installment_count integer NOT NULL CHECK (installment_count BETWEEN 1 AND 360),
  first_due_date    date NOT NULL,
  category_id       integer REFERENCES categories(id) ON DELETE SET NULL,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE installment_plans ADD COLUMN IF NOT EXISTS user_id integer REFERENCES users(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS transactions (
  id                  serial PRIMARY KEY,
  user_id             integer REFERENCES users(id) ON DELETE CASCADE,
  type                text NOT NULL CHECK (type IN ('income', 'expense')),
  description         text NOT NULL,
  amount              numeric(12,2) NOT NULL CHECK (amount > 0),
  category_id         integer REFERENCES categories(id) ON DELETE SET NULL,
  date                date NOT NULL,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'skipped')),
  note                text,
  source              text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'recurring', 'installment')),
  recurring_id        integer REFERENCES recurring_rules(id) ON DELETE SET NULL,
  installment_plan_id integer REFERENCES installment_plans(id) ON DELETE SET NULL,
  installment_no      integer,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS user_id integer REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS transactions_user_date_idx ON transactions (user_id, date);
CREATE INDEX IF NOT EXISTS recurring_rules_user_idx ON recurring_rules (user_id);
CREATE INDEX IF NOT EXISTS installment_plans_user_idx ON installment_plans (user_id);
-- (the unique index that keeps recurring payments from being generated twice is created further down, on occurrence_date)
CREATE UNIQUE INDEX IF NOT EXISTS transactions_installment_uq
  ON transactions (installment_plan_id, installment_no) WHERE installment_plan_id IS NOT NULL;

-- =====================================================================
-- Profiles, people, workspaces (personal + shared groups)
-- =====================================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;                       -- E.164 style, e.g. +491701234567
ALTER TABLE users ADD COLUMN IF NOT EXISTS discoverable boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS find_by_email boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS find_by_phone boolean NOT NULL DEFAULT true;

-- Give accounts that existed before usernames a unique one derived from their e-mail.
DO $$
DECLARE u record; base text; candidate text; n int;
BEGIN
  FOR u IN SELECT id, email FROM users WHERE username IS NULL ORDER BY id LOOP
    base := regexp_replace(lower(split_part(u.email, '@', 1)), '[^a-z0-9._]', '', 'g');
    base := regexp_replace(base, '^[._]+', '');
    base := regexp_replace(base, '[._]{2,}', '_', 'g');
    base := left(base, 20);
    IF length(base) < 3 THEN base := 'user' || base; END IF;
    candidate := base; n := 0;
    WHILE EXISTS (SELECT 1 FROM users WHERE lower(username) = candidate) LOOP
      n := n + 1; candidate := base || n;
    END LOOP;
    UPDATE users SET username = candidate WHERE id = u.id;
  END LOOP;
END $$;
ALTER TABLE users ALTER COLUMN username SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_uq ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_uq ON users (phone) WHERE phone IS NOT NULL;

-- A workspace is a budget: everyone has a private "personal" one; "group" workspaces are shared.
CREATE TABLE IF NOT EXISTS workspaces (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('personal', 'group')),
  owner_id   integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_personal_uq ON workspaces (owner_id) WHERE kind = 'personal';

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members (user_id);

CREATE TABLE IF NOT EXISTS workspace_invites (
  id           serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  inviter_id   integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id   integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_invites_pending_uq
  ON workspace_invites (workspace_id, invitee_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS workspace_invites_invitee_idx ON workspace_invites (invitee_id);

CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id    integer PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  currency        text NOT NULL DEFAULT 'USD'
);

-- Connections (partner / family / friend) between two people. One row per pair.
CREATE TABLE IF NOT EXISTS connections (
  id           serial PRIMARY KEY,
  requester_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relation     text NOT NULL DEFAULT 'friend' CHECK (relation IN ('partner', 'family', 'friend', 'other')),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CHECK (requester_id <> addressee_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS connections_pair_uq
  ON connections (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
CREATE INDEX IF NOT EXISTS connections_addressee_idx ON connections (addressee_id);

-- Budget data now belongs to a workspace. user_id stays as "created by"; member_id is who paid/received.
ALTER TABLE categories        ADD COLUMN IF NOT EXISTS workspace_id integer REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE recurring_rules   ADD COLUMN IF NOT EXISTS workspace_id integer REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE installment_plans ADD COLUMN IF NOT EXISTS workspace_id integer REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE transactions      ADD COLUMN IF NOT EXISTS workspace_id integer REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE recurring_rules   ADD COLUMN IF NOT EXISTS member_id integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE installment_plans ADD COLUMN IF NOT EXISTS member_id integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE transactions      ADD COLUMN IF NOT EXISTS member_id integer REFERENCES users(id) ON DELETE SET NULL;

-- Migrate existing accounts: a personal workspace each, owning what they already had.
INSERT INTO workspaces (name, kind, owner_id)
  SELECT 'Personal', 'personal', u.id FROM users u
  WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.kind = 'personal' AND w.owner_id = u.id);
INSERT INTO workspace_members (workspace_id, user_id, role)
  SELECT w.id, w.owner_id, 'owner' FROM workspaces w WHERE w.kind = 'personal'
  ON CONFLICT DO NOTHING;
UPDATE categories x SET workspace_id = w.id FROM workspaces w
  WHERE x.workspace_id IS NULL AND x.user_id IS NOT NULL AND w.kind = 'personal' AND w.owner_id = x.user_id;
UPDATE recurring_rules x SET workspace_id = w.id FROM workspaces w
  WHERE x.workspace_id IS NULL AND x.user_id IS NOT NULL AND w.kind = 'personal' AND w.owner_id = x.user_id;
UPDATE installment_plans x SET workspace_id = w.id FROM workspaces w
  WHERE x.workspace_id IS NULL AND x.user_id IS NOT NULL AND w.kind = 'personal' AND w.owner_id = x.user_id;
UPDATE transactions x SET workspace_id = w.id FROM workspaces w
  WHERE x.workspace_id IS NULL AND x.user_id IS NOT NULL AND w.kind = 'personal' AND w.owner_id = x.user_id;
UPDATE recurring_rules   SET member_id = user_id WHERE member_id IS NULL AND user_id IS NOT NULL;
UPDATE installment_plans SET member_id = user_id WHERE member_id IS NULL AND user_id IS NOT NULL;
UPDATE transactions      SET member_id = user_id WHERE member_id IS NULL AND user_id IS NOT NULL;
INSERT INTO workspace_settings (workspace_id, opening_balance, currency)
  SELECT w.id, s.opening_balance, s.currency FROM user_settings s
  JOIN workspaces w ON w.kind = 'personal' AND w.owner_id = s.user_id
  ON CONFLICT DO NOTHING;
INSERT INTO workspace_settings (workspace_id) SELECT id FROM workspaces ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS categories_ws_name_kind_uq ON categories (workspace_id, name, kind);
CREATE INDEX IF NOT EXISTS transactions_ws_date_idx ON transactions (workspace_id, date);
CREATE INDEX IF NOT EXISTS recurring_rules_ws_idx ON recurring_rules (workspace_id);
CREATE INDEX IF NOT EXISTS installment_plans_ws_idx ON installment_plans (workspace_id);

-- People who are "in on" a payment. share = their part of the amount (the creator keeps the rest).
CREATE TABLE IF NOT EXISTS transaction_participants (
  transaction_id          integer NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  user_id                 integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share                   numeric(12,2) NOT NULL DEFAULT 0 CHECK (share >= 0),
  imported_transaction_id integer REFERENCES transactions(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transaction_id, user_id)
);
CREATE INDEX IF NOT EXISTS transaction_participants_user_idx ON transaction_participants (user_id);

-- =====================================================================
-- Profile pictures, receipts, notifications and alerts
-- =====================================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_picture text;        -- Google's photo, used when no photo was uploaded
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
UPDATE users SET google_picture = avatar_url
  WHERE google_picture IS NULL AND google_id IS NOT NULL AND avatar_url LIKE 'http%';
-- Accounts created through Google have an e-mail address Google already verified.
UPDATE users SET email_verified_at = created_at
  WHERE email_verified_at IS NULL AND google_id IS NOT NULL AND password_hash IS NULL;

-- Uploaded photos live in their own table so they are never loaded with ordinary user lookups.
CREATE TABLE IF NOT EXISTS user_avatars (
  user_id    integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mime       text NOT NULL,
  data       bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS receipts (
  id             serial PRIMARY KEY,
  transaction_id integer NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  workspace_id   integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  uploaded_by    integer REFERENCES users(id) ON DELETE SET NULL,
  filename       text NOT NULL,
  mime           text NOT NULL,
  size_bytes     integer NOT NULL,
  data           bytea NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receipts_transaction_idx ON receipts (transaction_id);

CREATE TABLE IF NOT EXISTS app_config (
  key   text PRIMARY KEY,
  value text NOT NULL
);

-- One-time e-mail verification links (only a hash of the token is stored).
CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash text PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('verify')),
  email      text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_tokens_user_idx ON email_tokens (user_id);

CREATE TABLE IF NOT EXISTS notifications (
  id         bigserial PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  title      text NOT NULL,
  body       text,
  link       text,
  data       jsonb NOT NULL DEFAULT '{}',
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz,
  emailed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_uq ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_settings (
  user_id               integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- what appears in the app
  due_soon              boolean NOT NULL DEFAULT true,
  overdue               boolean NOT NULL DEFAULT true,
  balance_warning       boolean NOT NULL DEFAULT true,
  friend_requests       boolean NOT NULL DEFAULT true,
  group_invites         boolean NOT NULL DEFAULT true,
  shared_payments       boolean NOT NULL DEFAULT true,
  group_activity        boolean NOT NULL DEFAULT false,
  include_income        boolean NOT NULL DEFAULT false,
  lead_days             integer NOT NULL DEFAULT 3 CHECK (lead_days BETWEEN 0 AND 60),
  paused_until          timestamptz,
  browser_push          boolean NOT NULL DEFAULT false,
  -- e-mail
  email_enabled         boolean NOT NULL DEFAULT false,
  email_frequency       text NOT NULL DEFAULT 'daily' CHECK (email_frequency IN ('daily', 'instant')),
  email_hour            integer NOT NULL DEFAULT 8 CHECK (email_hour BETWEEN 0 AND 23),
  timezone              text NOT NULL DEFAULT 'UTC',
  email_due             boolean NOT NULL DEFAULT true,
  email_overdue         boolean NOT NULL DEFAULT true,
  email_balance         boolean NOT NULL DEFAULT true,
  email_social          boolean NOT NULL DEFAULT false,
  email_group_activity  boolean NOT NULL DEFAULT false,
  last_digest_on        date
);

-- Per-person choices about which payments alert them: a single payment, a whole recurring item, an
-- installment plan, or a category. "on" forces alerts, "off" silences them; days overrides "days before".
CREATE TABLE IF NOT EXISTS alert_overrides (
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('transaction', 'recurring', 'installment', 'category')),
  target_id   integer NOT NULL,
  mode        text NOT NULL CHECK (mode IN ('on', 'off')),
  days        integer CHECK (days BETWEEN 0 AND 60),
  PRIMARY KEY (user_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS email_log (
  id         bigserial PRIMARY KEY,
  user_id    integer REFERENCES users(id) ON DELETE CASCADE,
  to_email   text NOT NULL,
  subject    text NOT NULL,
  kind       text NOT NULL,
  status     text NOT NULL CHECK (status IN ('sent', 'preview', 'failed')),
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_log_user_idx ON email_log (user_id, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- Personalisation, insights and the extra notification types
-- ---------------------------------------------------------------------------------------------
-- Per-person interface choices (dashboard layout, density, accent colour, sidebar state, favourites).
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id    integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Insights a person has dismissed in a budget. Keys include the month, so a new month starts fresh.
CREATE TABLE IF NOT EXISTS insight_dismissals (
  user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  insight_key  text NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workspace_id, insight_key)
);

-- Optional "active now" status for people you are connected to.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_status boolean NOT NULL DEFAULT true;

ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS ai_insights     boolean NOT NULL DEFAULT true;
ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS weekly_summary  boolean NOT NULL DEFAULT false;
ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS monthly_summary boolean NOT NULL DEFAULT false;
ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS security_alerts boolean NOT NULL DEFAULT true;
ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS email_ai        boolean NOT NULL DEFAULT false;
ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS email_weekly    boolean NOT NULL DEFAULT false;
ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS email_monthly   boolean NOT NULL DEFAULT false;
ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS email_security  boolean NOT NULL DEFAULT true;
ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS weekly_day      integer NOT NULL DEFAULT 1 CHECK (weekly_day BETWEEN 0 AND 6);
ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS last_insight_on date;

-- "Forecast warnings" used to be part of "low balance". Split them, keeping everyone's existing choice.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notification_settings' AND column_name = 'forecast_warning') THEN
    ALTER TABLE notification_settings ADD COLUMN forecast_warning boolean NOT NULL DEFAULT true;
    ALTER TABLE notification_settings ADD COLUMN email_forecast   boolean NOT NULL DEFAULT true;
    UPDATE notification_settings SET forecast_warning = balance_warning, email_forecast = email_balance;
  END IF;
END $$;

-- Credit card payments. `date` stays the day the money leaves the account (so balance, forecast and alerts keep working);
-- `charged_on` is the day it was bought on the card.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS pay_method text NOT NULL DEFAULT 'cash' CHECK (pay_method IN ('cash', 'credit_card'));
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS charged_on date;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_card_consistent') THEN
    ALTER TABLE transactions ADD CONSTRAINT transactions_card_consistent CHECK (
      (pay_method = 'cash' AND charged_on IS NULL)
      OR (pay_method = 'credit_card' AND type = 'expense' AND charged_on IS NOT NULL AND charged_on <= date));
  END IF;
END $$;
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS card_pay_day integer NOT NULL DEFAULT 10 CHECK (card_pay_day BETWEEN 1 AND 28);

-- A recurring payment remembers the schedule slot it was generated for, so moving it to another day does not free the slot
-- (which used to make the top-up create a second copy).
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS occurrence_date date;
UPDATE transactions SET occurrence_date = date WHERE recurring_id IS NOT NULL AND occurrence_date IS NULL;
DROP INDEX IF EXISTS transactions_recurring_uq;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_recurring_slot_uq
  ON transactions (recurring_id, occurrence_date) WHERE recurring_id IS NOT NULL;

-- Debts: money you owe. Repayments are ordinary expense payments (source 'debt') linked back through debt_id.
CREATE TABLE IF NOT EXISTS debts (
  id                serial PRIMARY KEY,
  workspace_id      integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id           integer REFERENCES users(id) ON DELETE SET NULL,
  member_id         integer REFERENCES users(id) ON DELETE SET NULL,
  name              text NOT NULL,
  total_amount      numeric(12,2) NOT NULL CHECK (total_amount > 0),
  note              text,
  category_id       integer REFERENCES categories(id) ON DELETE SET NULL,
  plan              text NOT NULL DEFAULT 'none' CHECK (plan IN ('none', 'once', 'monthly')),
  first_due_date    date,
  installment_count integer,
  count_in_budget   boolean NOT NULL DEFAULT true,
  settled_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT debts_plan_consistent CHECK (
    (plan = 'none' AND first_due_date IS NULL AND installment_count IS NULL)
    OR (plan = 'once' AND first_due_date IS NOT NULL AND installment_count IS NULL)
    OR (plan = 'monthly' AND first_due_date IS NOT NULL AND installment_count BETWEEN 2 AND 120))
);
CREATE INDEX IF NOT EXISTS debts_workspace_idx ON debts (workspace_id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS debt_id integer REFERENCES debts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS transactions_debt_idx ON transactions (debt_id) WHERE debt_id IS NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'transactions'::regclass AND contype = 'c'
                 AND pg_get_constraintdef(oid) LIKE '%source%' AND pg_get_constraintdef(oid) LIKE '%debt%') THEN
    ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_source_check;
    ALTER TABLE transactions ADD CONSTRAINT transactions_source_check CHECK (source IN ('manual', 'recurring', 'installment', 'debt'));
  END IF;
END $$;

-- Carry what is left over at the end of a month into the next one (shown on the Payments page; nothing is stored as a payment)
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS carry_over boolean NOT NULL DEFAULT true;

-- A credit card purchase paid in installments: the price before interest and the day it was bought (the plan's payments are card payments)
ALTER TABLE installment_plans ADD COLUMN IF NOT EXISTS purchase_amount numeric(12,2) CHECK (purchase_amount > 0);
ALTER TABLE installment_plans ADD COLUMN IF NOT EXISTS charged_on date;

-- The balance a person does not want to go below: warnings use it instead of zero (0 = as before)
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS min_balance numeric(14,2) NOT NULL DEFAULT 0 CHECK (min_balance >= 0);

-- A payment made by "match my bank balance": it fixes the balance but is not spending or income
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'transactions'::regclass AND contype = 'c'
                 AND pg_get_constraintdef(oid) LIKE '%source%' AND pg_get_constraintdef(oid) LIKE '%adjustment%') THEN
    ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_source_check;
    ALTER TABLE transactions ADD CONSTRAINT transactions_source_check CHECK (source IN ('manual', 'recurring', 'installment', 'debt', 'adjustment'));
  END IF;
END $$;

-- Money owed TO you: a debt has a direction ('owe' is what every earlier debt is, 'lent' is someone owing you).
-- Repayments of a lent debt are income; the money handed over is a payment with source 'loan' (not spending).
ALTER TABLE debts ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'owe';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'debts'::regclass AND conname = 'debts_direction_check') THEN
    ALTER TABLE debts ADD CONSTRAINT debts_direction_check CHECK (direction IN ('owe', 'lent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'transactions'::regclass AND contype = 'c'
                 AND pg_get_constraintdef(oid) LIKE '%source%' AND pg_get_constraintdef(oid) LIKE '%loan%') THEN
    ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_source_check;
    ALTER TABLE transactions ADD CONSTRAINT transactions_source_check CHECK (source IN ('manual', 'recurring', 'installment', 'debt', 'adjustment', 'loan'));
  END IF;
END $$;
