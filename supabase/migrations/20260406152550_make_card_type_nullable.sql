/*
  # Make card_type nullable in payments table

  1. Changes
    - Drop the NOT NULL constraint on card_type column
    - This allows storing payment category information in selected_payment_option JSONB field
    - The check constraint still ensures valid values when card_type is provided

  2. Reason
    - Payment categories like "Visa/Master/Rupay Card" contain multiple card types
    - The actual card type used will be determined by the payment gateway
    - Full category information is already stored in selected_payment_option JSONB field
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payments' 
    AND column_name = 'card_type' 
    AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE payments ALTER COLUMN card_type DROP NOT NULL;
  END IF;
END $$;
