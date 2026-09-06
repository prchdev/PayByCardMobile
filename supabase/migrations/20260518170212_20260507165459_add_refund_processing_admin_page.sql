/*
  # Add Refund Processing to admin_pages

  - Inserts the refund-processing page entry
  - Grants view+edit to super_admin and admin, view-only to moderator
*/

INSERT INTO admin_pages (page_key, page_name, page_path, description, icon, display_order, is_active)
VALUES ('refund-processing', 'Refund Processing', '/admin/refund-processing', 'Process refunds for expired KYC verifications', 'Undo2', 13, true)
ON CONFLICT (page_key) DO NOTHING;

INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT 'super_admin', id, true, true FROM admin_pages WHERE page_key = 'refund-processing'
ON CONFLICT (role, page_id) DO NOTHING;

INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT 'admin', id, true, true FROM admin_pages WHERE page_key = 'refund-processing'
ON CONFLICT (role, page_id) DO NOTHING;

INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT 'moderator', id, true, false FROM admin_pages WHERE page_key = 'refund-processing'
ON CONFLICT (role, page_id) DO NOTHING;