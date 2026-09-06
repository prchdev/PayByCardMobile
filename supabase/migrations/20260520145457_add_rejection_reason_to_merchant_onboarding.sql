/*
  # Add rejection_reason to merchant_onboarding

  1. Changes
    - Add `rejection_reason` (text, nullable) for storing admin rejection notes
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'merchant_onboarding' AND column_name = 'rejection_reason'
  ) THEN
    ALTER TABLE merchant_onboarding ADD COLUMN rejection_reason text;
  END IF;
END $$;
