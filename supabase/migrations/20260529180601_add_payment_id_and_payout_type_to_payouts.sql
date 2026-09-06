/*
  # Add payment_id and payout_type to payouts table

  1. Changes to `payouts`
    - `payment_id` (uuid, nullable) - Links payout to the originating payment
    - `payout_type` (text, default 'manual') - 'manual' or 'auto'

  2. Notes
    - Additive only, no destructive changes
    - payment_id is nullable since manual payouts may not link to a specific payment
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payouts' AND column_name = 'payment_id'
  ) THEN
    ALTER TABLE payouts ADD COLUMN payment_id uuid REFERENCES payments(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payouts' AND column_name = 'payout_type'
  ) THEN
    ALTER TABLE payouts ADD COLUMN payout_type text DEFAULT 'manual';
  END IF;
END $$;
