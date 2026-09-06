/*
  # Add Admin Reports and User Summary pages

  1. New admin_pages entries
    - `reports` — Transaction reports with filters and export
    - `user-summary` — User profile summary lookup

  2. Role permissions
    - super_admin and admin: view + edit
    - moderator: view only
*/

INSERT INTO admin_pages (page_key, page_name, page_path, description, icon, display_order, is_active)
VALUES
  ('reports',      'Reports',      '/admin/reports',      'Transaction reports with filters and Excel/PDF export', 'BarChart2', 13, true),
  ('user-summary', 'User Summary', '/admin/user-summary', 'Search and view full user profile and transaction history', 'UserSearch', 14, true)
ON CONFLICT (page_key) DO NOTHING;

INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT 'super_admin', id, true, true FROM admin_pages WHERE page_key IN ('reports', 'user-summary')
ON CONFLICT (role, page_id) DO NOTHING;

INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT 'admin', id, true, true FROM admin_pages WHERE page_key IN ('reports', 'user-summary')
ON CONFLICT (role, page_id) DO NOTHING;

INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT 'moderator', id, true, false FROM admin_pages WHERE page_key IN ('reports', 'user-summary')
ON CONFLICT (role, page_id) DO NOTHING;
