/*
  # Rename payment_categories table to payment_options

  1. Changes
    - Rename table `payment_categories` to `payment_options`
    - Update all foreign key constraints to reference the new table name
    - All existing data, indexes, and constraints are preserved

  2. Security
    - RLS policies remain unchanged
    - All permissions are preserved
*/

-- Rename the table
ALTER TABLE IF EXISTS payment_categories RENAME TO payment_options;

-- Update the foreign key constraint name in the payments table for clarity
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'payments_payment_category_id_fkey'
    AND table_name = 'payments'
  ) THEN
    ALTER TABLE payments 
    DROP CONSTRAINT payments_payment_category_id_fkey;
    
    ALTER TABLE payments
    ADD CONSTRAINT payments_payment_option_id_fkey
    FOREIGN KEY (payment_category_id) 
    REFERENCES payment_options(id);
  END IF;
END $$;
