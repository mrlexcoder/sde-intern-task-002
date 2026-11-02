PRAGMA foreign_keys = ON;

CREATE TABLE homes (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CONSTRAINT homes_name_nonempty CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE members (
  id TEXT PRIMARY KEY NOT NULL,
  home_id TEXT NOT NULL CONSTRAINT members_home_fk REFERENCES homes(id) ON DELETE CASCADE,
  name TEXT NOT NULL CONSTRAINT members_name_nonempty CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX members_home_order ON members(home_id, created_at, id);

CREATE TABLE bills (
  id TEXT PRIMARY KEY NOT NULL,
  home_id TEXT NOT NULL CONSTRAINT bills_home_fk REFERENCES homes(id) ON DELETE CASCADE,
  title TEXT NOT NULL CONSTRAINT bills_title_nonempty CHECK (length(trim(title)) > 0),
  total_cents INTEGER NOT NULL CONSTRAINT bills_positive_total CHECK (total_cents > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE shares (
  id TEXT PRIMARY KEY NOT NULL,
  bill_id TEXT NOT NULL CONSTRAINT shares_bill_fk REFERENCES bills(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL CONSTRAINT shares_member_fk REFERENCES members(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CONSTRAINT shares_positive_amount CHECK (amount_cents > 0),
  paid_at TEXT,
  idempotency_key TEXT,
  CONSTRAINT shares_one_member_per_bill UNIQUE (bill_id, member_id)
);
