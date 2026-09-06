/*
  # Fix payment_categories foreign key constraint

  1. Changes
    - Drop incorrect foreign key constraint on updated_by_admin_id pointing to auth.users
    - Add correct foreign key constraint pointing to admin_users table
  
  2. Notes
    - This fixes the issue where admin updates fail because the foreign key was pointing to the wrong table
*/

-- Drop the incorrect foreign key constraint
ALTER TABLE payment_categories 
DROP CONSTRAINT IF EXISTS payment_categories_updated_by_admin_id_fkey;

-- Add the correct foreign key constraint pointing to admin_users
ALTER TABLE payment_categories
ADD CONSTRAINT payment_categories_updated_by_admin_id_fkey 
FOREIGN KEY (updated_by_admin_id) 
REFERENCES admin_users(id) 
ON DELETE SET NULL;