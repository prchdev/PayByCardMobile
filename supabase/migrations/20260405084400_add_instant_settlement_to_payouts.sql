/*
  # Add Instant Settlement Fields to Payouts

  1. Changes to `payouts` table
    - Add `instant_settlement` (boolean) - Flag to indicate if instant settlement was requested
    - Add `instant_settlement_charges` (numeric) - Additional charges for instant settlement
    - Add `instant_settlement_charges_percentage` (numeric) - Percentage charged for instant settlement

  2. Notes
    - Default value for instant_settlement is false
    - Charges are calculated based on the gateway's instant settlement percentage
    - These charges are added to the total_deduction amount
*/

DO $$
BEGIN
  -- Add instant settlement flag
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payouts' AND column_name = 'instant_settlement'
  ) THEN
    ALTER TABLE payouts 
    ADD COLUMN instant_settlement BOOLEAN DEFAULT false;
  END IF;

  -- Add instant settlement charges
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payouts' AND column_name = 'instant_settlement_charges'
  ) THEN
    ALTER TABLE payouts 
    ADD COLUMN instant_settlement_charges NUMERIC(15,2) DEFAULT 0.00;
  END IF;

  -- Add instant settlement charges percentage
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payouts' AND column_name = 'instant_settlement_charges_percentage'
  ) THEN
    ALTER TABLE payouts 
    ADD COLUMN instant_settlement_charges_percentage NUMERIC(5,2) DEFAULT 0.00;
  END IF;
END $$;