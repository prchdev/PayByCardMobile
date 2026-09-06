/*
  # Add business surcharge and KYC settings to payment_options

  1. Changes to `payment_options`
    - `business_surcharge_percentage` (numeric, default 0) — extra surcharge added on top of base charges for business/current accounts
    - `receiver_kyc_required` (boolean, default false) — whether receiver must complete KYC before payout is released

  2. Notes
    - These are additive columns; all existing rows default safely to 0 / false
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_options' AND column_name = 'business_surcharge_percentage'
  ) THEN
    ALTER TABLE payment_options ADD COLUMN business_surcharge_percentage numeric DEFAULT 0 NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_options' AND column_name = 'receiver_kyc_required'
  ) THEN
    ALTER TABLE payment_options ADD COLUMN receiver_kyc_required boolean DEFAULT false NOT NULL;
  END IF;
END $$;