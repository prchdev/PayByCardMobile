/*
  # Add Master Settings, Manual Payout, and Non-KYCed Transactions to Admin Pages

  1. Changes
    - Insert admin_pages entries for master-settings, manual-payout, and non-kyced-transactions
    - Insert role_permissions for all three roles (super_admin, admin, moderator)

  2. Notes
    - Uses ON CONFLICT DO NOTHING so re-running is safe
    - Non-KYCed Transactions: payments where receiver KYC is required, refund window has passed, but KYC not submitted
    - display_order chosen to keep logical grouping
*/

INSERT INTO admin_pages (page_key, page_name, page_path, description, icon, display_order, is_active)
VALUES
  ('master-settings',        'Master Settings',           '/admin/master-settings',          'Manage company master settings',                        'Settings',    10, true),
  ('manual-payout',          'Manual Payout',             '/admin/manual-payout',            'Process and manage manual payouts',                     'Wallet',      11, true),
  ('non-kyced-transactions', 'Non-KYCed Transactions',    '/admin/non-kyced-transactions',   'Payments where receiver KYC was required but not done',  'AlertTriangle', 12, true)
ON CONFLICT (page_key) DO NOTHING;

-- Grant all three roles view+edit on the new pages
INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT 'super_admin', id, true, true FROM admin_pages WHERE page_key IN ('master-settings','manual-payout','non-kyced-transactions')
ON CONFLICT (role, page_id) DO NOTHING;

INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT 'admin', id, true, true FROM admin_pages WHERE page_key IN ('master-settings','manual-payout','non-kyced-transactions')
ON CONFLICT (role, page_id) DO NOTHING;

INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT 'moderator', id, true, false FROM admin_pages WHERE page_key IN ('master-settings','manual-payout','non-kyced-transactions')
ON CONFLICT (role, page_id) DO NOTHING;