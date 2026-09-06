/*
  # Fix Support Tickets closed_by Foreign Key Constraint

  1. Changes
    - Remove the foreign key constraint from `closed_by` column in `support_tickets` table
    - The `closed_by` field will store admin_users ID instead of users ID
    - Keep the column as UUID type to maintain data integrity

  2. Reason
    - Tickets are closed by admin users (from admin_users table), not regular users
    - The original constraint was incorrectly referencing users table
    - Removing the constraint allows storing admin_users IDs without foreign key violations
*/

-- Drop the existing foreign key constraint on closed_by
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name LIKE '%support_tickets%closed_by%'
    AND table_name = 'support_tickets'
  ) THEN
    ALTER TABLE support_tickets
    DROP CONSTRAINT IF EXISTS support_tickets_closed_by_fkey;
  END IF;
END $$;
