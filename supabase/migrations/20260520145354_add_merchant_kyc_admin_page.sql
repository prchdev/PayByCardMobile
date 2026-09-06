/*
  # Add Merchant KYC Verification admin page

  1. New admin_pages entry
    - `merchant-kyc` page key, path /admin/merchant-kyc, icon ShieldCheck, display_order 3 (after user KYC)
  2. role_permissions entries
    - Grant can_view and can_edit for all existing roles
*/

INSERT INTO admin_pages (page_key, page_name, page_path, description, icon, display_order, is_active)
VALUES (
  'merchant-kyc',
  'Merchant KYC',
  '/admin/merchant-kyc',
  'Review and approve merchant KYC / onboarding submissions',
  'ShieldCheck',
  3,
  true
)
ON CONFLICT (page_key) DO NOTHING;

-- Grant permissions to all roles that already exist in role_permissions
INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT DISTINCT rp.role, ap.id, true, true
FROM role_permissions rp
CROSS JOIN admin_pages ap
WHERE ap.page_key = 'merchant-kyc'
ON CONFLICT (role, page_id) DO NOTHING;
