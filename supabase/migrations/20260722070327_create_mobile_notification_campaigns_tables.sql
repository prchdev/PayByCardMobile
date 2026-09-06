/*
# Mobile Application Notification Campaigns

## Purpose
Allows admins to create notification campaigns that the mobile application reads
to push notifications to users. Admins can schedule campaigns with start/end dates,
preferred push time windows, and frequency (Once or Daily). Campaigns can be ended
early before the scheduled end date.

## 1. New Tables

### mobile_notification_campaigns
Stores the campaign definition created by admin.
- `id` (uuid, PK) — unique campaign identifier
- `campaign_name` (text, NOT NULL) — admin-provided name for the campaign
- `title` (text, NOT NULL) — notification title shown to mobile users
- `message` (text, NOT NULL) — notification body text
- `image_url` (text, NULL) — optional image URL shown in the notification
- `start_date` (date, NOT NULL) — when the campaign becomes active
- `end_date` (date, NOT NULL) — when the campaign expires
- `push_time_from` (time, NOT NULL) — earliest preferred push time (e.g. 09:00)
- `push_time_to` (time, NOT NULL) — latest preferred push time (e.g. 12:00)
- `frequency` (text, NOT NULL DEFAULT 'once') — 'once' or 'daily'
- `status` (text, NOT NULL DEFAULT 'active') — 'active', 'ended', 'expired'
- `ended_at` (timestamptz, NULL) — timestamp when admin ended campaign early
- `ended_by_admin_id` (uuid, NULL) — admin who ended the campaign
- `created_by_admin_id` (uuid, NOT NULL) — admin who created the campaign
- `created_at` (timestamptz, DEFAULT now())
- `updated_at` (timestamptz, DEFAULT now())

### mobile_notification_logs
Tracks each notification push event — which campaign was pushed, to which user,
at what time, and its delivery status. The mobile app (or a server-side cron) reads
active campaigns and inserts rows here when a notification is dispatched.
- `id` (uuid, PK)
- `campaign_id` (uuid, FK → mobile_notification_campaigns.id ON DELETE CASCADE)
- `user_id` (uuid, NULL) — target user (NULL = broadcast to all)
- `pushed_at` (timestamptz, DEFAULT now()) — when the notification was sent
- `status` (text, NOT NULL DEFAULT 'pending') — 'pending', 'delivered', 'failed'
- `error_message` (text, NULL) — failure reason if status = 'failed'
- `created_at` (timestamptz, DEFAULT now())

## 2. Storage
- Create public bucket `notification-images` for campaign notification images.

## 3. Admin Page Permission
- Insert a new row into `admin_pages` for the notification campaign management page.
- Grant view+edit permissions to all existing roles (super_admin, admin, moderator).

## 4. Security
- RLS enabled on both tables.
- Both tables are managed exclusively by admin edge functions using the service role key,
  so policies allow anon/authenticated read (mobile app reads campaigns) and all writes
  are done server-side via service role (bypasses RLS).
- mobile_notification_campaigns: anon+authenticated can SELECT (mobile app reads active
  campaigns); INSERT/UPDATE/DELETE are service-role only (no anon policy needed).
- mobile_notification_logs: anon+authenticated can SELECT and INSERT (mobile app logs
  push events); UPDATE/DELETE are service-role only.
*/

-- =========================================================
-- 1. mobile_notification_campaigns
-- =========================================================
CREATE TABLE IF NOT EXISTS mobile_notification_campaigns (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_name        text NOT NULL,
  title                text NOT NULL,
  message              text NOT NULL,
  image_url            text,
  start_date           date NOT NULL,
  end_date             date NOT NULL,
  push_time_from       time NOT NULL,
  push_time_to         time NOT NULL,
  frequency            text NOT NULL DEFAULT 'once' CHECK (frequency IN ('once', 'daily')),
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'expired')),
  ended_at             timestamptz,
  ended_by_admin_id    uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_by_admin_id  uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mobile_notification_campaigns ENABLE ROW LEVEL SECURITY;

-- Mobile app reads active campaigns (anon key client)
DROP POLICY IF EXISTS "anon_read_campaigns" ON mobile_notification_campaigns;
CREATE POLICY "anon_read_campaigns"
ON mobile_notification_campaigns FOR SELECT
TO anon, authenticated USING (true);

-- =========================================================
-- 2. mobile_notification_logs
-- =========================================================
CREATE TABLE IF NOT EXISTS mobile_notification_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES mobile_notification_campaigns(id) ON DELETE CASCADE,
  user_id       uuid,
  pushed_at     timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mobile_notification_logs ENABLE ROW LEVEL SECURITY;

-- Mobile app can read and insert log entries
DROP POLICY IF EXISTS "anon_read_logs" ON mobile_notification_logs;
CREATE POLICY "anon_read_logs"
ON mobile_notification_logs FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_logs" ON mobile_notification_logs;
CREATE POLICY "anon_insert_logs"
ON mobile_notification_logs FOR INSERT
TO anon, authenticated WITH CHECK (true);

-- =========================================================
-- 3. Indexes
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_mnc_status ON mobile_notification_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_mnc_dates ON mobile_notification_campaigns(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_mnl_campaign_id ON mobile_notification_logs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_mnl_user_id ON mobile_notification_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_mnl_pushed_at ON mobile_notification_logs(pushed_at);

-- =========================================================
-- 4. Storage bucket for notification images
-- =========================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('notification-images', 'notification-images', true)
ON CONFLICT (id) DO NOTHING;

-- Public read for notification images
DROP POLICY IF EXISTS "public_read_notification_images" ON storage.objects;
CREATE POLICY "public_read_notification_images"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'notification-images');

-- Only authenticated users can upload (admin uploads via edge function)
DROP POLICY IF EXISTS "auth_upload_notification_images" ON storage.objects;
CREATE POLICY "auth_upload_notification_images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'notification-images');

-- =========================================================
-- 5. Admin page registration
-- =========================================================
INSERT INTO admin_pages (page_key, page_name, page_path, description, icon, display_order, is_active)
VALUES (
  'mobile-notifications',
  'Mobile Notifications',
  '/admin/mobile-notifications',
  'Create and manage mobile app push notification campaigns',
  'Bell',
  12,
  true
)
ON CONFLICT (page_key) DO UPDATE SET
  page_name = EXCLUDED.page_name,
  page_path = EXCLUDED.page_path,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  is_active = EXCLUDED.is_active;

-- Grant permissions to all existing roles
INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT r.role, ap.id, true, true
FROM admin_pages ap
CROSS JOIN (VALUES ('super_admin'), ('admin'), ('moderator')) AS r(role)
WHERE ap.page_key = 'mobile-notifications'
ON CONFLICT (role, page_id) DO UPDATE SET
  can_view = true,
  can_edit = true;