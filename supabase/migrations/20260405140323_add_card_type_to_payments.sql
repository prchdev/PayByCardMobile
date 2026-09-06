/*
  # Add Card Type and Gateway Details to Payments

  1. Changes
    - Add `card_type` field to track which card type was selected
    - Add `allowed_cards` field to store which cards are allowed for this payment
    - Add `gateway_environment` field to track test vs production
    - Add `payment_url` field to store the gateway redirect URL
    - Add `gateway_request` field to log the request sent to gateway
    - Add indexes for better query performance

  2. Security
    - No RLS changes needed as existing policies cover new fields
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'card_type'
  ) THEN
    ALTER TABLE payments ADD COLUMN card_type text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'allowed_cards'
  ) THEN
    ALTER TABLE payments ADD COLUMN allowed_cards jsonb DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'gateway_environment'
  ) THEN
    ALTER TABLE payments ADD COLUMN gateway_environment text DEFAULT 'Testing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'payment_url'
  ) THEN
    ALTER TABLE payments ADD COLUMN payment_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'gateway_request'
  ) THEN
    ALTER TABLE payments ADD COLUMN gateway_request jsonb;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments(payment_reference);
CREATE INDEX IF NOT EXISTS idx_payments_gateway_txn ON payments(gateway_transaction_id);
CREATE INDEX IF NOT EXISTS idx_payment_logs_payment_id ON payment_logs(payment_id);
