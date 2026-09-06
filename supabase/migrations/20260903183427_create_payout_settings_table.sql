/*
# Create payout_settings table for global payout configuration

Stores page-level global payout settings (environment, payout mode)
and per-provider payout API credentials (CashFree, Razorpay, Axis Bank Neo).

Previously payout credentials were stored per-gateway in payment_gateway_settings.
Now they are centralized here with a single row for global settings.
*/

CREATE TABLE IF NOT EXISTS payout_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment text NOT NULL DEFAULT 'test',
  payout_mode text NOT NULL DEFAULT 'manual',

  -- CashFree Payout Credentials
  cashfree_test_client_id text NOT NULL DEFAULT '',
  cashfree_test_client_secret text NOT NULL DEFAULT '',
  cashfree_production_client_id text NOT NULL DEFAULT '',
  cashfree_production_client_secret text NOT NULL DEFAULT '',
  cashfree_test_2fa_public_key text NOT NULL DEFAULT '',
  cashfree_production_2fa_public_key text NOT NULL DEFAULT '',

  -- Razorpay Payout Credentials
  razorpay_test_key_id text NOT NULL DEFAULT '',
  razorpay_test_key_secret text NOT NULL DEFAULT '',
  razorpay_production_key_id text NOT NULL DEFAULT '',
  razorpay_production_key_secret text NOT NULL DEFAULT '',
  razorpay_test_account_number text NOT NULL DEFAULT '',
  razorpay_production_account_number text NOT NULL DEFAULT '',

  -- Axis Bank Neo Corporate API Credentials
  axis_test_client_id text NOT NULL DEFAULT '',
  axis_test_client_secret text NOT NULL DEFAULT '',
  axis_production_client_id text NOT NULL DEFAULT '',
  axis_production_client_secret text NOT NULL DEFAULT '',
  axis_test_base_url text NOT NULL DEFAULT 'https://uatapis.axisbank.co.uk',
  axis_production_base_url text NOT NULL DEFAULT 'https://apis.axisbank.co.uk',
  axis_corporate_id text NOT NULL DEFAULT '',
  axis_test_virtual_account text NOT NULL DEFAULT '',
  axis_production_virtual_account text NOT NULL DEFAULT '',

  -- Audit
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES admin_users(id),
  updated_ip text DEFAULT ''
);

ALTER TABLE payout_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_payout_settings" ON payout_settings FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "insert_payout_settings" ON payout_settings FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY "update_payout_settings" ON payout_settings FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_payout_settings" ON payout_settings FOR DELETE
  TO authenticated USING (true);

-- Seed a single default row
INSERT INTO payout_settings (environment, payout_mode)
VALUES ('test', 'manual')
ON CONFLICT DO NOTHING;

-- Add admin page entry
INSERT INTO admin_pages (page_key, page_name, page_path, icon, display_order, is_active)
VALUES ('payout-settings', 'Payout Settings', '/admin/payout-settings', 'Wallet', 45, true)
ON CONFLICT (page_key) DO UPDATE SET
  page_name = EXCLUDED.page_name,
  page_path = EXCLUDED.page_path,
  icon = EXCLUDED.icon,
  is_active = true;

-- Grant default permissions to admin and super_admin roles
INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT 'admin', id, true, true FROM admin_pages WHERE page_key = 'payout-settings'
ON CONFLICT (role, page_id) DO NOTHING;

INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT 'super_admin', id, true, true FROM admin_pages WHERE page_key = 'payout-settings'
ON CONFLICT (role, page_id) DO NOTHING;
