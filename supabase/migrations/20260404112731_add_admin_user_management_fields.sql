/*
  # Add Admin User Management Fields

  1. Changes to `admin_users` table
    - Add `role` column (super_admin, admin, moderator)
    - Add `last_login` timestamp column
    - Add `created_by` column for tracking who created the admin
    - Add `updated_by` column for tracking who updated the admin

  2. Security Updates
    - Update RLS policies for role-based access
    - Super admins can manage other admins
    - Admins can view other admins but not manage them

  3. Notes
    - Default role is 'admin'
    - Only super_admin can create/disable other admins
    - Existing admin will be set as super_admin
*/

-- Add new columns to admin_users table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_users' AND column_name = 'role'
  ) THEN
    ALTER TABLE admin_users ADD COLUMN role text NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin', 'moderator'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_users' AND column_name = 'last_login'
  ) THEN
    ALTER TABLE admin_users ADD COLUMN last_login timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_users' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE admin_users ADD COLUMN created_by uuid REFERENCES admin_users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_users' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE admin_users ADD COLUMN updated_by uuid REFERENCES admin_users(id);
  END IF;
END $$;

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_users_is_active ON admin_users(is_active);
CREATE INDEX IF NOT EXISTS idx_admin_users_role ON admin_users(role);

-- Update existing admin user to super_admin (if exists)
DO $$
BEGIN
  UPDATE admin_users 
  SET role = 'super_admin' 
  WHERE id = (SELECT id FROM admin_users ORDER BY created_at ASC LIMIT 1);
END $$;

-- Drop existing policies
DROP POLICY IF EXISTS "Admins can view all admin users" ON admin_users;
DROP POLICY IF EXISTS "Super admins can insert new admin users" ON admin_users;
DROP POLICY IF EXISTS "Super admins can update admin users" ON admin_users;
DROP POLICY IF EXISTS "Admins can update own profile" ON admin_users;

-- Policy: Admins can view all admin users
CREATE POLICY "Admins can view all admin users"
  ON admin_users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users a
      WHERE a.id = auth.uid()
      AND a.is_active = true
    )
  );

-- Policy: Super admins can insert new admin users
CREATE POLICY "Super admins can insert new admin users"
  ON admin_users FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users a
      WHERE a.id = auth.uid()
      AND a.role = 'super_admin'
      AND a.is_active = true
    )
  );

-- Policy: Super admins can update admin users
CREATE POLICY "Super admins can update admin users"
  ON admin_users FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users a
      WHERE a.id = auth.uid()
      AND a.role = 'super_admin'
      AND a.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users a
      WHERE a.id = auth.uid()
      AND a.role = 'super_admin'
      AND a.is_active = true
    )
  );

-- Policy: Admins can update their own profile (but not role or is_active)
CREATE POLICY "Admins can update own profile"
  ON admin_users FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid() 
    AND role = (SELECT role FROM admin_users WHERE id = auth.uid())
    AND is_active = (SELECT is_active FROM admin_users WHERE id = auth.uid())
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_admin_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_update_admin_users_updated_at ON admin_users;
CREATE TRIGGER trigger_update_admin_users_updated_at
  BEFORE UPDATE ON admin_users
  FOR EACH ROW
  EXECUTE FUNCTION update_admin_users_updated_at();