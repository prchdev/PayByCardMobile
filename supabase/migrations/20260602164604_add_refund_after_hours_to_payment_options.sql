/*
  # Add refund_after_hours to payment_options

  ## Summary
  The previous migration that added this column targeted the old table name
  `payment_categories`, which has since been renamed to `payment_options`.
  This migration adds the column to the correct table.

  ## Changes
  - `payment_options`
    - `refund_after_hours` (integer, NOT NULL, DEFAULT 0)
      Number of hours after payment creation to wait before auto-refunding a
      kyc_pending payment whose receiver has not completed KYC. A value of 0
      means auto-refund is disabled for that category.

  ## Notes
  - Existing rows default to 0 (disabled)
  - Safe to re-run (IF NOT EXISTS guard)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_options' AND column_name = 'refund_after_hours'
  ) THEN
    ALTER TABLE payment_options ADD COLUMN refund_after_hours integer NOT NULL DEFAULT 0;
  END IF;
END $$;
