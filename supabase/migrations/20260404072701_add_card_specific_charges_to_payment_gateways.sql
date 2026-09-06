/*
  # Add Card-Specific Charges and Payout Charges

  1. Changes to `payment_gateway_settings` table
    - Add `visa_charges` (numeric) - Charges for Visa card transactions (percentage)
    - Add `mastercard_charges` (numeric) - Charges for Mastercard transactions (percentage)
    - Add `rupay_charges` (numeric) - Charges for RuPay card transactions (percentage)
    - Add `amex_charges` (numeric) - Charges for American Express transactions (percentage)
    - Add `diners_charges` (numeric) - Charges for Diners Club card transactions (percentage)
    - Add `payout_charges_inr` (numeric) - Payout charges per transaction in INR (flat fee)
  
  2. Notes
    - All card charges are percentages with 2 decimal precision
    - Payout charges are flat fees in INR with 2 decimal precision
    - Default values set to 0.00 for all new fields
*/

DO $$
BEGIN
  -- Add Visa charges
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_gateway_settings' AND column_name = 'visa_charges'
  ) THEN
    ALTER TABLE payment_gateway_settings 
    ADD COLUMN visa_charges NUMERIC(5,2) DEFAULT 0.00;
  END IF;

  -- Add Mastercard charges
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_gateway_settings' AND column_name = 'mastercard_charges'
  ) THEN
    ALTER TABLE payment_gateway_settings 
    ADD COLUMN mastercard_charges NUMERIC(5,2) DEFAULT 0.00;
  END IF;

  -- Add RuPay charges
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_gateway_settings' AND column_name = 'rupay_charges'
  ) THEN
    ALTER TABLE payment_gateway_settings 
    ADD COLUMN rupay_charges NUMERIC(5,2) DEFAULT 0.00;
  END IF;

  -- Add American Express charges
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_gateway_settings' AND column_name = 'amex_charges'
  ) THEN
    ALTER TABLE payment_gateway_settings 
    ADD COLUMN amex_charges NUMERIC(5,2) DEFAULT 0.00;
  END IF;

  -- Add Diners Club charges
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_gateway_settings' AND column_name = 'diners_charges'
  ) THEN
    ALTER TABLE payment_gateway_settings 
    ADD COLUMN diners_charges NUMERIC(5,2) DEFAULT 0.00;
  END IF;

  -- Add Payout charges in INR
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_gateway_settings' AND column_name = 'payout_charges_inr'
  ) THEN
    ALTER TABLE payment_gateway_settings 
    ADD COLUMN payout_charges_inr NUMERIC(10,2) DEFAULT 0.00;
  END IF;
END $$;