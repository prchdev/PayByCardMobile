/*
  # Add Transaction Summary Fields to Payments

  1. Changes
    - Add `transaction_summary` field to store complete payment details from summary page
    - Add `selected_payment_option` field to store the selected payment option details
    - Add `beneficiary_details` field to store beneficiary information snapshot
    - Add `category_details` field to store category information snapshot

  2. Security
    - No RLS changes needed as existing policies cover new fields

  3. Notes
    - These fields capture a complete snapshot of the transaction at the time of payment
    - Useful for audit trails and dispute resolution
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'transaction_summary'
  ) THEN
    ALTER TABLE payments ADD COLUMN transaction_summary jsonb DEFAULT '{}'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'selected_payment_option'
  ) THEN
    ALTER TABLE payments ADD COLUMN selected_payment_option jsonb DEFAULT '{}'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'beneficiary_details'
  ) THEN
    ALTER TABLE payments ADD COLUMN beneficiary_details jsonb DEFAULT '{}'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'category_details'
  ) THEN
    ALTER TABLE payments ADD COLUMN category_details jsonb DEFAULT '{}'::jsonb;
  END IF;
END $$;

COMMENT ON COLUMN payments.transaction_summary IS 'Complete snapshot of transaction details from summary page';
COMMENT ON COLUMN payments.selected_payment_option IS 'Selected payment option including card type, charges, gateway info';
COMMENT ON COLUMN payments.beneficiary_details IS 'Beneficiary information at time of payment';
COMMENT ON COLUMN payments.category_details IS 'Payment category information at time of payment';
