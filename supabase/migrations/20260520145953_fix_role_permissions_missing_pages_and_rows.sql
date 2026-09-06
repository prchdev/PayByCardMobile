/*
  # Fix Role Permissions: missing pages and rows

  1. Add kyc-method to admin_pages (was hardcoded in AdminLayout, never in DB)
  2. Add moderator row for payment-limits (was missing)
  3. Ensure every active page has a role_permissions row for all three roles
     (super_admin/admin/moderator) using safe INSERT ... ON CONFLICT DO NOTHING
*/

-- 1. Add kyc-method page to admin_pages
INSERT INTO admin_pages (page_key, page_name, page_path, description, icon, display_order, is_active)
VALUES (
  'kyc-method',
  'KYC Method',
  '/admin/kyc-method',
  'Configure KYC verification method and provider',
  'ScanFace',
  7,
  true
)
ON CONFLICT (page_key) DO NOTHING;

-- 2. Ensure all active pages have permission rows for all three roles
-- Using a cross-join so we get one row per (role, page) combination
INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT
  roles.role,
  ap.id,
  CASE
    -- super_admin always gets full access
    WHEN roles.role = 'super_admin' THEN true
    -- moderator gets view-only for most pages, no access to sensitive ones
    WHEN roles.role = 'moderator' AND ap.page_key IN (
      'email', 'sms', 'payment-gateway', 'payment-charges',
      'role-permissions', 'master-settings', 'kyc-method'
    ) THEN false
    ELSE true
  END AS can_view,
  CASE
    -- super_admin always gets full edit
    WHEN roles.role = 'super_admin' THEN true
    -- moderator never gets edit
    WHEN roles.role = 'moderator' THEN false
    -- admin loses edit on sensitive pages
    WHEN roles.role = 'admin' AND ap.page_key IN (
      'role-permissions'
    ) THEN false
    ELSE true
  END AS can_edit
FROM admin_pages ap
CROSS JOIN (VALUES ('super_admin'), ('admin'), ('moderator')) AS roles(role)
WHERE ap.is_active = true
ON CONFLICT (role, page_id) DO NOTHING;
