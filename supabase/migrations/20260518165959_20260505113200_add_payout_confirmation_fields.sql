/*
  # Add Payout Confirmation Fields

  1. Modified Tables
    - `payouts`
      - `payout_date` (date) - Date when payout was processed
      - `payout_reference_number` (text) - Reference number from bank/gateway
      - `payout_confirmed_amount` (numeric) - Actual amount confirmed in payout
      - `payout_confirmed_by` (uuid) - Admin who confirmed the payout
      - `payout_confirmed_at` (timestamptz) - Timestamp of confirmation
      - `refund_reason` (text) - Reason if refunded
      - `refunded_by` (uuid) - Admin who processed refund
      - `refunded_at` (timestamptz) - Timestamp of refund

  2. Important Notes
    - These fields support manual payout confirmation workflow
    - Existing payouts get NULL for these new columns
    - No data is dropped or deleted
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payouts' AND column_name = 'payout_date'
  ) THEN
    ALTER TABLE payouts ADD COLUMN payout_date date;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payouts' AND column_name = 'payout_reference_number'
  ) THEN
    ALTER TABLE payouts ADD COLUMN payout_reference_number text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payouts' AND column_name = 'payout_confirmed_amount'
  ) THEN
    ALTER TABLE payouts ADD COLUMN payout_confirmed_amount numeric(15,2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payouts' AND column_name = 'payout_confirmed_by'
  ) THEN
    ALTER TABLE payouts ADD COLUMN payout_confirmed_by uuid;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payouts' AND column_name = 'payout_confirmed_at'
  ) THEN
    ALTER TABLE payouts ADD COLUMN payout_confirmed_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payouts' AND column_name = 'refund_reason'
  ) THEN
    ALTER TABLE payouts ADD COLUMN refund_reason text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payouts' AND column_name = 'refunded_by'
  ) THEN
    ALTER TABLE payouts ADD COLUMN refunded_by uuid;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payouts' AND column_name = 'refunded_at'
  ) THEN
    ALTER TABLE payouts ADD COLUMN refunded_at timestamptz;
  END IF;
END $$;