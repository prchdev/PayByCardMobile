/*
  # Fix Payment Gateway Settings Foreign Keys

  1. Changes
    - Drop existing foreign key constraints on created_by and updated_by
    - Add new foreign key constraints referencing admin_users table instead of auth.users
    
  2. Reason
    - The payment gateway settings are managed by admin users from the admin_users table
    - The original foreign keys referenced auth.users which is incorrect for this use case
*/

-- Drop the existing foreign key constraints
ALTER TABLE payment_gateway_settings
  DROP CONSTRAINT IF EXISTS payment_gateway_settings_created_by_fkey;

ALTER TABLE payment_gateway_settings
  DROP CONSTRAINT IF EXISTS payment_gateway_settings_updated_by_fkey;

-- Add new foreign key constraints referencing admin_users
ALTER TABLE payment_gateway_settings
  ADD CONSTRAINT payment_gateway_settings_created_by_fkey 
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL;

ALTER TABLE payment_gateway_settings
  ADD CONSTRAINT payment_gateway_settings_updated_by_fkey 
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL;
