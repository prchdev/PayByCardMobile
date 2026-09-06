/*
  # Add Audit Fields to Email Settings

  1. Changes to email_settings table
    - Add `updated_by_admin_id` (uuid) - ID of admin who made the change
    - Add `updated_by_admin_name` (text) - Name of admin who made the change
    - Add `updated_by_ip_address` (text) - IP address of the admin
    - Update existing `updated_at` to track when changes were made
    - Drop old `updated_by` column and replace with more detailed tracking

  2. Important Notes
    - Tracks complete audit trail for email settings changes
    - IP address captured for security and compliance
    - Admin name stored for easy reference without joins
*/

-- Add new audit columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'email_settings' AND column_name = 'updated_by_admin_id'
  ) THEN
    ALTER TABLE email_settings ADD COLUMN updated_by_admin_id uuid;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'email_settings' AND column_name = 'updated_by_admin_name'
  ) THEN
    ALTER TABLE email_settings ADD COLUMN updated_by_admin_name text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'email_settings' AND column_name = 'updated_by_ip_address'
  ) THEN
    ALTER TABLE email_settings ADD COLUMN updated_by_ip_address text;
  END IF;
END $$;

-- Drop the old updated_by column if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'email_settings' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE email_settings DROP COLUMN updated_by;
  END IF;
END $$;