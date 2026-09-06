/*
  # Add sender_name and category_name to merchant_onboarding

  1. Changes
    - Add `sender_name` (text) — name of the payment sender, shown on the onboarding page
    - Add `category_name` (text) — payment category name, shown on the onboarding page
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'merchant_onboarding' AND column_name = 'sender_name'
  ) THEN
    ALTER TABLE merchant_onboarding ADD COLUMN sender_name text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'merchant_onboarding' AND column_name = 'category_name'
  ) THEN
    ALTER TABLE merchant_onboarding ADD COLUMN category_name text DEFAULT '';
  END IF;
END $$;
