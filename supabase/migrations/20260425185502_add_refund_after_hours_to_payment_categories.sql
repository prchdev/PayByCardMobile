/*
  # Add refund_after_hours to payment_categories

  1. Modified Tables
    - `payment_categories`
      - `refund_after_hours` (integer, default 0) - Hours after which payment is refunded if receiver KYC is not completed. Only used when receiver_kyc_required is true.

  2. Important Notes
    - Existing rows get default value of 0
    - No data is dropped or deleted
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_categories' AND column_name = 'refund_after_hours'
  ) THEN
    ALTER TABLE payment_categories ADD COLUMN refund_after_hours integer NOT NULL DEFAULT 0;
  END IF;
END $$;
