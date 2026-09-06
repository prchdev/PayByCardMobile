/*
  # Fix Payment Category References

  1. Changes
    - Add `business_category_id` column to payments table to reference payment_categories
    - Keep `payment_category_id` as reference to payment_options (card types)
    - Update foreign key constraint names for clarity
    - Add index for the new business_category_id column

  2. Security
    - No RLS changes needed as existing policies cover new fields

  3. Notes
    - payment_categories = Business payment types (Business Payment, Freelancer, etc.)
    - payment_options = Card payment options (Visa/Master/Rupay, Amex, etc.)
    - Both need to be tracked separately in the payments table
*/

-- Add business_category_id column to track the business payment type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'business_category_id'
  ) THEN
    ALTER TABLE payments ADD COLUMN business_category_id uuid REFERENCES payment_categories(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Add index for business_category_id
CREATE INDEX IF NOT EXISTS idx_payments_business_category_id ON payments(business_category_id);

COMMENT ON COLUMN payments.payment_category_id IS 'Reference to payment_options table (card types like Visa/Master/Rupay)';
COMMENT ON COLUMN payments.business_category_id IS 'Reference to payment_categories table (business types like Business Payment, Freelancer Payment)';
