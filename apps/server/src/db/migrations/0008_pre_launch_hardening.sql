-- Pre-launch hardening migration.
--
-- 1. De-duplicate room_members and add PRIMARY KEY (room_id, user_id).
--    Without a PK, every onConflictDoNothing() callsite is a silent no-op
--    and concurrent auto-joins on WebSocket reconnect can create duplicate
--    rows.
-- 2. Add covering indexes for the hot read paths that are currently doing
--    sequential scans.
-- 3. Rename notification_preferences.invite_received_email to
--    access_granted_email so the DB column matches the protocol field
--    (drops the service-layer mapping shim).

-- 1. Deduplicate room_members.
--    Keep the row with the highest-precedence role (owner > admin > member)
--    and the earliest joined_at as the tiebreak.
WITH ranked AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY room_id, user_id
      ORDER BY
        CASE role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 ELSE 1 END DESC,
        joined_at ASC
    ) AS rn
  FROM room_members
)
DELETE FROM room_members
WHERE ctid IN (SELECT ctid FROM ranked WHERE rn > 1);

ALTER TABLE room_members
  ADD CONSTRAINT room_members_pkey PRIMARY KEY (room_id, user_id);

-- 2. Hot-path indexes.
--    room_members.user_id: every "list my rooms" query filters on this.
--    rooms.owner_id: owner-scoped queries (count owned rooms, list trash).
--    subscriptions.stripe_customer_id: every Stripe webhook routes by this.
--    Note: tabs(room_id) is already covered by the leading column of the
--    existing UNIQUE INDEX (room_id, ordinal) and is intentionally not added.
CREATE INDEX IF NOT EXISTS room_members_user_id_idx
  ON room_members (user_id);
CREATE INDEX IF NOT EXISTS rooms_owner_id_idx
  ON rooms (owner_id);
CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_id_idx
  ON subscriptions (stripe_customer_id);

-- 3. Rename column to match the protocol field name.
ALTER TABLE notification_preferences
  RENAME COLUMN invite_received_email TO access_granted_email;
