/*
  # Fix Support Ticket Replies Foreign Key

  ## Changes
  1. Drop the existing foreign key constraint on `replied_by` that references `users` table
  2. Make `replied_by` nullable to allow it to be null for admin replies (since admins are in `admin_users` table)
  3. Add a new column `admin_replied_by` that references `admin_users` table
  4. Add a check constraint to ensure either `replied_by` OR `admin_replied_by` is set, but not both
  
  ## Migration Details
  - Removes hard constraint that forces all replies to come from `users` table
  - Allows admin replies to reference `admin_users` table properly
  - Maintains data integrity with check constraint
*/

-- Drop the existing foreign key constraint
ALTER TABLE support_ticket_replies 
  DROP CONSTRAINT IF EXISTS support_ticket_replies_replied_by_fkey;

-- Make replied_by nullable
ALTER TABLE support_ticket_replies 
  ALTER COLUMN replied_by DROP NOT NULL;

-- Add admin_replied_by column
ALTER TABLE support_ticket_replies 
  ADD COLUMN IF NOT EXISTS admin_replied_by uuid REFERENCES admin_users(id) ON DELETE CASCADE;

-- Add foreign key back for replied_by (but now nullable)
ALTER TABLE support_ticket_replies 
  ADD CONSTRAINT support_ticket_replies_replied_by_fkey 
  FOREIGN KEY (replied_by) REFERENCES users(id) ON DELETE CASCADE;

-- Add check constraint to ensure exactly one of replied_by or admin_replied_by is set
ALTER TABLE support_ticket_replies 
  ADD CONSTRAINT check_one_replier CHECK (
    (replied_by IS NOT NULL AND admin_replied_by IS NULL) OR 
    (replied_by IS NULL AND admin_replied_by IS NOT NULL)
  );