/*
# Create mobile notification system

1. New Tables
- `mobile_notifications` — per-user in-app notifications for KYC, beneficiary, payment events, and campaigns
  - id, user_id, type, title, body, data (jsonb), is_read, campaign_id (nullable FK), created_at
2. Modified Tables
- `mobile_notification_campaigns` — add target_audience, action_url, action_label columns
- `mobile_notification_logs` — add action column for tracking shown/clicked/dismissed
3. Security
- Enable RLS on mobile_notifications (owner-scoped CRUD)
- Add RLS policies to mobile_notification_campaigns (authenticated can read active)
- Add RLS policies to mobile_notification_logs (owner-scoped insert/select)
4. Helper Function
- create_mobile_notification() — SECURITY DEFINER function for edge functions to insert notifications
*/

-- ── mobile_notifications (new table) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS mobile_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  data jsonb DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  campaign_id uuid REFERENCES mobile_notification_campaigns(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mobile_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_notifications" ON mobile_notifications;
CREATE POLICY "select_own_notifications" ON mobile_notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_notifications" ON mobile_notifications;
CREATE POLICY "insert_own_notifications" ON mobile_notifications
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_notifications" ON mobile_notifications;
CREATE POLICY "update_own_notifications" ON mobile_notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_notifications" ON mobile_notifications;
CREATE POLICY "delete_own_notifications" ON mobile_notifications
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_mobile_notifications_user_id ON mobile_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_mobile_notifications_is_read ON mobile_notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_mobile_notifications_created_at ON mobile_notifications(created_at DESC);

-- ── Add columns to mobile_notification_campaigns ──────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mobile_notification_campaigns' AND column_name='target_audience') THEN
    ALTER TABLE mobile_notification_campaigns ADD COLUMN target_audience text NOT NULL DEFAULT 'all';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mobile_notification_campaigns' AND column_name='action_url') THEN
    ALTER TABLE mobile_notification_campaigns ADD COLUMN action_url text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mobile_notification_campaigns' AND column_name='action_label') THEN
    ALTER TABLE mobile_notification_campaigns ADD COLUMN action_label text;
  END IF;
END $$;

-- ── Add columns to mobile_notification_logs ───────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mobile_notification_logs' AND column_name='action') THEN
    ALTER TABLE mobile_notification_logs ADD COLUMN action text;
  END IF;
END $$;

-- ── RLS on mobile_notification_campaigns ──────────────────────────────
ALTER TABLE mobile_notification_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_active_campaigns" ON mobile_notification_campaigns;
CREATE POLICY "read_active_campaigns" ON mobile_notification_campaigns
  FOR SELECT TO authenticated USING (status = 'active');

-- ── RLS on mobile_notification_logs ────────────────────────────────────
ALTER TABLE mobile_notification_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_logs" ON mobile_notification_logs;
CREATE POLICY "select_own_logs" ON mobile_notification_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_logs" ON mobile_notification_logs;
CREATE POLICY "insert_own_logs" ON mobile_notification_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_logs_campaign_user ON mobile_notification_logs(campaign_id, user_id);
CREATE INDEX IF NOT EXISTS idx_logs_user_id ON mobile_notification_logs(user_id);

-- ── Helper function for edge functions ────────────────────────────────
CREATE OR REPLACE FUNCTION create_mobile_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text DEFAULT NULL,
  p_data jsonb DEFAULT '{}'::jsonb,
  p_campaign_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO mobile_notifications (user_id, type, title, body, data, campaign_id)
  VALUES (p_user_id, p_type, p_title, p_body, p_data, p_campaign_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION create_mobile_notification(uuid, text, text, text, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_mobile_notification(uuid, text, text, text, jsonb, uuid) TO authenticated, anon;