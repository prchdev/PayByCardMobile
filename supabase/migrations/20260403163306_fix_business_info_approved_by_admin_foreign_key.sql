/*
  # Fix Foreign Key Constraint on Business Info Approval Column

  1. Changes
    - Drop the incorrect foreign key constraint that references auth.users
    - This matches the structure of other KYC tables which don't have foreign key constraints
    - Admin IDs are stored in admin_users table, not auth.users
  
  2. Notes
    - This ensures consistency with kyc_pan_verification and kyc_address_proof tables
    - The approved_by_admin_id column will still store admin UUIDs, but without enforcing referential integrity
    - This is acceptable since admin management is handled separately
*/

-- Drop the foreign key constraint on approved_by_admin_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'kyc_business_info_approved_by_admin_id_fkey'
  ) THEN
    ALTER TABLE kyc_business_info DROP CONSTRAINT kyc_business_info_approved_by_admin_id_fkey;
  END IF;
END $$;
