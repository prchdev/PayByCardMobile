/*
  # Create Role-Based Access Control System

  1. New Tables
    - `admin_pages`
      - `id` (uuid, primary key)
      - `page_key` (text, unique) - Unique identifier for the page (e.g., 'dashboard', 'kyc', 'users')
      - `page_name` (text) - Display name of the page
      - `page_path` (text) - Route path of the page
      - `description` (text) - Description of what the page does
      - `icon` (text) - Icon name for the page
      - `display_order` (integer) - Order in which pages should be displayed
      - `is_active` (boolean) - Whether the page is currently active
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `role_permissions`
      - `id` (uuid, primary key)
      - `role` (text) - The admin role (super_admin, admin, moderator)
      - `page_id` (uuid, foreign key to admin_pages)
      - `can_view` (boolean) - Whether the role can view this page
      - `can_edit` (boolean) - Whether the role can edit/modify on this page
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      - Unique constraint on (role, page_id)

  2. Security
    - Enable RLS on both tables
    - Add policies for authenticated admin users to read
    - Add policies for super_admin to manage permissions

  3. Initial Data
    - Insert default admin pages
    - Insert default role permissions for all roles
*/

-- Create admin_pages table
CREATE TABLE IF NOT EXISTS admin_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_key text UNIQUE NOT NULL,
  page_name text NOT NULL,
  page_path text NOT NULL,
  description text DEFAULT '',
  icon text DEFAULT 'LayoutDashboard',
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create role_permissions table
CREATE TABLE IF NOT EXISTS role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL CHECK (role IN ('super_admin', 'admin', 'moderator')),
  page_id uuid NOT NULL REFERENCES admin_pages(id) ON DELETE CASCADE,
  can_view boolean DEFAULT false,
  can_edit boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(role, page_id)
);

-- Enable RLS
ALTER TABLE admin_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- Policies for admin_pages (all authenticated admins can read)
CREATE POLICY "Authenticated admins can view admin pages"
  ON admin_pages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
      AND admin_users.is_active = true
    )
  );

CREATE POLICY "Super admins can insert admin pages"
  ON admin_pages FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
      AND admin_users.role = 'super_admin'
      AND admin_users.is_active = true
    )
  );

CREATE POLICY "Super admins can update admin pages"
  ON admin_pages FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
      AND admin_users.role = 'super_admin'
      AND admin_users.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
      AND admin_users.role = 'super_admin'
      AND admin_users.is_active = true
    )
  );

-- Policies for role_permissions
CREATE POLICY "Authenticated admins can view role permissions"
  ON role_permissions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
      AND admin_users.is_active = true
    )
  );

CREATE POLICY "Super admins can insert role permissions"
  ON role_permissions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
      AND admin_users.role = 'super_admin'
      AND admin_users.is_active = true
    )
  );

CREATE POLICY "Super admins can update role permissions"
  ON role_permissions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
      AND admin_users.role = 'super_admin'
      AND admin_users.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
      AND admin_users.role = 'super_admin'
      AND admin_users.is_active = true
    )
  );

CREATE POLICY "Super admins can delete role permissions"
  ON role_permissions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
      AND admin_users.role = 'super_admin'
      AND admin_users.is_active = true
    )
  );

-- Insert default admin pages
INSERT INTO admin_pages (page_key, page_name, page_path, description, icon, display_order) VALUES
  ('dashboard', 'Dashboard', '/admin/dashboard', 'Main dashboard with overview and statistics', 'LayoutDashboard', 1),
  ('kyc', 'KYC Verification', '/admin/kyc', 'Review and manage KYC submissions', 'FileCheck', 2),
  ('users', 'User Management', '/admin/users', 'Manage admin users and their roles', 'Users', 3),
  ('email', 'Email Settings', '/admin/email-settings', 'Configure email server and templates', 'Mail', 4),
  ('sms', 'SMS Settings', '/admin/sms-settings', 'Configure SMS gateway settings', 'MessageSquare', 5),
  ('payment-gateway', 'Payment Gateway', '/admin/payment-gateway', 'Configure payment gateway settings', 'CreditCard', 6),
  ('payment-charges', 'Payment Charges', '/admin/payment-charges', 'Manage payment categories and charges', 'IndianRupee', 7),
  ('role-permissions', 'Role Permissions', '/admin/role-permissions', 'Configure role-based access control', 'Shield', 8)
ON CONFLICT (page_key) DO NOTHING;

-- Insert default role permissions
-- Super Admin: Full access to all pages
INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT 'super_admin', id, true, true
FROM admin_pages
ON CONFLICT (role, page_id) DO NOTHING;

-- Admin: View all pages, edit most except role permissions
INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT 'admin', id, true,
  CASE
    WHEN page_key IN ('role-permissions', 'users') THEN false
    ELSE true
  END
FROM admin_pages
ON CONFLICT (role, page_id) DO NOTHING;

-- Moderator: Limited access
INSERT INTO role_permissions (role, page_id, can_view, can_edit)
SELECT 'moderator', id,
  CASE
    WHEN page_key IN ('dashboard', 'kyc') THEN true
    ELSE false
  END,
  CASE
    WHEN page_key IN ('kyc') THEN true
    ELSE false
  END
FROM admin_pages
ON CONFLICT (role, page_id) DO NOTHING;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role);
CREATE INDEX IF NOT EXISTS idx_role_permissions_page_id ON role_permissions(page_id);
CREATE INDEX IF NOT EXISTS idx_admin_pages_page_key ON admin_pages(page_key);
CREATE INDEX IF NOT EXISTS idx_admin_pages_display_order ON admin_pages(display_order);
