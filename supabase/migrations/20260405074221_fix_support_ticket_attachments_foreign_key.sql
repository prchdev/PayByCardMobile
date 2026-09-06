/*
  # Fix Support Ticket Attachments Foreign Key

  ## Changes
  1. Drop the existing foreign key constraint on `uploaded_by` that references `users` table
  2. Make `uploaded_by` nullable to allow it to be null for admin uploads
  3. Add a new column `admin_uploaded_by` that references `admin_users` table
  4. Add a check constraint to ensure either `uploaded_by` OR `admin_uploaded_by` is set, but not both
  
  ## Migration Details
  - Removes hard constraint that forces all uploads to come from `users` table
  - Allows admin uploads to reference `admin_users` table properly
  - Maintains data integrity with check constraint
*/

-- Drop the existing foreign key constraint
ALTER TABLE support_ticket_attachments 
  DROP CONSTRAINT IF EXISTS support_ticket_attachments_uploaded_by_fkey;

-- Make uploaded_by nullable
ALTER TABLE support_ticket_attachments 
  ALTER COLUMN uploaded_by DROP NOT NULL;

-- Add admin_uploaded_by column
ALTER TABLE support_ticket_attachments 
  ADD COLUMN IF NOT EXISTS admin_uploaded_by uuid REFERENCES admin_users(id) ON DELETE CASCADE;

-- Add foreign key back for uploaded_by (but now nullable)
ALTER TABLE support_ticket_attachments 
  ADD CONSTRAINT support_ticket_attachments_uploaded_by_fkey 
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE;

-- Add check constraint to ensure exactly one of uploaded_by or admin_uploaded_by is set
ALTER TABLE support_ticket_attachments 
  ADD CONSTRAINT check_one_uploader CHECK (
    (uploaded_by IS NOT NULL AND admin_uploaded_by IS NULL) OR 
    (uploaded_by IS NULL AND admin_uploaded_by IS NOT NULL)
  );