/*
# Add Bulk Email and Bulk SMS Admin Pages

## Purpose
Inserts two new admin pages into the admin_pages table so they appear in the
sidebar navigation and the Role Permissions grid. Also creates default role
permissions for super_admin (full access), admin (view+edit), and moderator (view only).

## New Admin Pages
1. bulk-email — "Bulk Email" at /admin/bulk-email (icon: Send, display_order: 15)
2. bulk-sms — "Bulk SMS" at /admin/bulk-sms (icon: Smartphone, display_order: 16)

## Role Permissions
- super_admin: can_view=true, can_edit=true (both pages)
- admin: can_view=true, can_edit=true (both pages)
- moderator: can_view=true, can_edit=false (both pages)
*/

INSERT INTO admin_pages (page_key, page_name, page_path, description, icon, display_order, is_active)
VALUES
  ('bulk-email', 'Bulk Email', '/admin/bulk-email', 'Compose and send parameterized bulk emails to users', 'Send', 15, true),
  ('bulk-sms', 'Bulk SMS', '/admin/bulk-sms', 'Compose and send parameterized bulk SMS to users', 'Smartphone', 16, true)
ON CONFLICT (page_key) DO NOTHING;

-- Grant default permissions for the new pages
INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT 'super_admin', id, true, true FROM admin_pages WHERE page_key IN ('bulk-email', 'bulk-sms')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT 'admin', id, true, true FROM admin_pages WHERE page_key IN ('bulk-email', 'bulk-sms')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT 'moderator', id, true, false FROM admin_pages WHERE page_key IN ('bulk-email', 'bulk-sms')
ON CONFLICT DO NOTHING;
