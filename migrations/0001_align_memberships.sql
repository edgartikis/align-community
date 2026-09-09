PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS membership_groups (
  id TEXT PRIMARY KEY,
  plan_key TEXT NOT NULL,
  level TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  founder_rate INTEGER NOT NULL DEFAULT 0,
  monthly_amount_cents INTEGER NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES membership_groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  member_code TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Activa',
  joined_at TEXT NOT NULL,
  photo_url TEXT NOT NULL DEFAULT '',
  savings_cents INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (group_id) REFERENCES membership_groups(id) ON DELETE CASCADE,
  UNIQUE (group_id, position)
);

CREATE TABLE IF NOT EXISTS pending_registrations (
  id TEXT PRIMARY KEY,
  plan_key TEXT NOT NULL,
  level TEXT NOT NULL,
  seats INTEGER NOT NULL,
  founder_rate INTEGER NOT NULL DEFAULT 0,
  amount_cents INTEGER NOT NULL,
  username TEXT NOT NULL COLLATE NOCASE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  members_json TEXT NOT NULL,
  stripe_session_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_username ON pending_registrations(username);
CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_registrations(status);
CREATE INDEX IF NOT EXISTS idx_groups_customer ON membership_groups(stripe_customer_id);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  stripe_invoice_id TEXT UNIQUE,
  stripe_checkout_session_id TEXT UNIQUE,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'mxn',
  status TEXT NOT NULL,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES membership_groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS webhook_events (
  stripe_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL
);
