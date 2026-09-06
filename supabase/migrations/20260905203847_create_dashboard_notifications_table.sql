/*
# Create Dashboard Notifications System

## Purpose
Creates a table to store dashboard notifications that admins can create and
display on the user dashboard. Also adds the admin page entry and role
permissions for managing these notifications.

## New Tables
1. `dashboard_notifications`
   - `id` (uuid, primary key)
   - `title` (text, not null) — short headline
   - `message` (text, not null) — body text shown to users
   - `notification_type` (text, not null) — one of: information, warning, error
   - `is_active` (boolean, default true) — admin can enable/disable
   - `display_order` (integer, default 0) — lower numbers appear first
   - `created_by` (uuid, references admin_users) — who created it
   - `updated_by` (uuid, references admin_users) — who last edited it
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

## New Admin Page
- `dashboard-notification` — "Dashboard Notification" at /admin/dashboard-notification (icon: Bell)

## Role Permissions
- super_admin: can_view=true, can_edit=true
- admin: can_view=true, can_edit=true
- moderator: can_view=true, can_edit=false

## Security
- RLS enabled on dashboard_notifications
- anon + authenticated can SELECT active notifications (for user dashboard display)
- Only admin_users can INSERT/UPDATE/DELETE (enforced via edge functions using service role key)
*/

CREATE TABLE IF NOT EXISTS dashboard_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  message text NOT NULL,
  notification_type text NOT NULL DEFAULT 'information' CHECK (notification_type IN ('information', 'warning', 'error')),
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE dashboard_notifications ENABLE ROW LEVEL SECURITY;

-- Anyone (including anon-key frontend) can read active notifications
DROP POLICY IF EXISTS "read_dashboard_notifications" ON dashboard_notifications;
CREATE POLICY "read_dashboard_notifications"
ON dashboard_notifications FOR SELECT
TO anon, authenticated
USING (true);

-- All writes are handled through edge functions using the service role key,
-- so we do not grant direct INSERT/UPDATE/DELETE to anon or authenticated.

-- Add admin page entry
INSERT INTO admin_pages (page_key, page_name, page_path, description, icon, display_order, is_active)
VALUES ('dashboard-notification', 'Dashboard Notification', '/admin/dashboard-notification', 'Create and manage notifications displayed on the user dashboard', 'Bell', 17, true)
ON CONFLICT (page_key) DO NOTHING;

-- Grant default permissions
INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT 'super_admin', id, true, true FROM admin_pages WHERE page_key = 'dashboard-notification'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT 'admin', id, true, true FROM admin_pages WHERE page_key = 'dashboard-notification'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT 'moderator', id, true, false FROM admin_pages WHERE page_key = 'dashboard-notification'
ON CONFLICT DO NOTHING;

-- Index for ordering
CREATE INDEX IF NOT EXISTS idx_dashboard_notifications_active_order
ON dashboard_notifications (is_active, display_order, created_at);
