/*
  # Add card type and gateway environment fields to payments table

  1. Changes to `payments` table
    - Add `card_type` (text) - Type of card used (visa, mastercard, rupay, amex, diners)
    - Add `card_last_four` (text) - Last 4 digits of card
    - Add `gateway_environment` (text) - Environment used (test/production)
    - Add `gateway_request` (jsonb) - Gateway request payload
    - Add `gateway_status_code` (text) - Gateway status code
    - Add `failure_reason` (text) - Reason for payment failure

  2. Security
    - Existing RLS policies apply
    - No changes to permissions

  3. Notes
    - Card type is stored for analytics and reporting
    - Full card number is never stored, only last 4 digits
    - Gateway environment helps track test vs production transactions
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'card_type'
  ) THEN
    ALTER TABLE payments ADD COLUMN card_type text CHECK (card_type IN ('visa', 'mastercard', 'rupay', 'amex', 'diners'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'card_last_four'
  ) THEN
    ALTER TABLE payments ADD COLUMN card_last_four text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'gateway_environment'
  ) THEN
    ALTER TABLE payments ADD COLUMN gateway_environment text DEFAULT 'production' CHECK (gateway_environment IN ('test', 'production'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'gateway_request'
  ) THEN
    ALTER TABLE payments ADD COLUMN gateway_request jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'gateway_status_code'
  ) THEN
    ALTER TABLE payments ADD COLUMN gateway_status_code text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'failure_reason'
  ) THEN
    ALTER TABLE payments ADD COLUMN failure_reason text;
  END IF;
END $$;