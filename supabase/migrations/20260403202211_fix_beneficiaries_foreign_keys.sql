/*
  # Fix beneficiaries table foreign keys

  1. Changes
    - Drop existing foreign key constraints that reference auth.users
    - Add new foreign key constraints that reference public.users
    - This fixes the issue where beneficiaries cannot be added because the user_id references the wrong table

  2. Details
    - The application uses public.users table for user management
    - The beneficiaries table was incorrectly referencing auth.users
    - This migration corrects all foreign key references to point to public.users
*/

-- Drop existing foreign key constraints
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'beneficiaries_user_id_fkey'
    AND table_name = 'beneficiaries'
  ) THEN
    ALTER TABLE beneficiaries DROP CONSTRAINT beneficiaries_user_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'beneficiaries_created_by_fkey'
    AND table_name = 'beneficiaries'
  ) THEN
    ALTER TABLE beneficiaries DROP CONSTRAINT beneficiaries_created_by_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'beneficiaries_updated_by_fkey'
    AND table_name = 'beneficiaries'
  ) THEN
    ALTER TABLE beneficiaries DROP CONSTRAINT beneficiaries_updated_by_fkey;
  END IF;
END $$;

-- Add new foreign key constraints referencing public.users
ALTER TABLE beneficiaries 
  ADD CONSTRAINT beneficiaries_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE beneficiaries 
  ADD CONSTRAINT beneficiaries_created_by_fkey 
  FOREIGN KEY (created_by) REFERENCES public.users(id);

ALTER TABLE beneficiaries 
  ADD CONSTRAINT beneficiaries_updated_by_fkey 
  FOREIGN KEY (updated_by) REFERENCES public.users(id);