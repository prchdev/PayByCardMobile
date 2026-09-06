/*
  # Add Instant Settlement Charges Percentage

  1. Changes to `payment_gateway_settings` table
    - Add `instant_settlement_charges_percentage` (numeric) - Percentage charges for instant settlement transactions
  
  2. Notes
    - This is a flat percentage that applies to all instant settlement transactions
    - Default value set to 0.00
    - Precision set to (5,2) allowing values up to 999.99%
*/

DO $$
BEGIN
  -- Add instant settlement charges percentage
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_gateway_settings' AND column_name = 'instant_settlement_charges_percentage'
  ) THEN
    ALTER TABLE payment_gateway_settings 
    ADD COLUMN instant_settlement_charges_percentage NUMERIC(5,2) DEFAULT 0.00;
  END IF;
END $$;