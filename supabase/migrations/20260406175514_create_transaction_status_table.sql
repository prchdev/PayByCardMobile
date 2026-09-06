/*
  # Create transaction_status table

  1. New Tables
    - `transaction_status`
      - `id` (uuid, primary key) - Unique identifier
      - `payment_id` (uuid, foreign key) - Reference to payments table
      - `user_id` (uuid, not null) - User who made the transaction
      - `transaction_reference` (text, not null) - Payment reference number
      - `status` (text, not null) - Transaction status (success, failed, pending)
      - `amount` (numeric, not null) - Transaction amount
      - `gateway_response` (jsonb) - Full gateway response data
      - `error_message` (text) - Error message if failed
      - `gateway_transaction_id` (text) - Gateway's transaction ID
      - `payment_method` (text) - Payment method used
      - `card_type` (text) - Type of card used
      - `gateway_name` (text) - Name of payment gateway
      - `created_at` (timestamptz) - When status was recorded
      - `updated_at` (timestamptz) - When status was last updated

  2. Security
    - Enable RLS on `transaction_status` table
    - Add policy for users to read their own transaction status
    - Add policy for service role to insert transaction status
*/

-- Create transaction_status table
CREATE TABLE IF NOT EXISTS transaction_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid REFERENCES payments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  transaction_reference text NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'failed', 'pending', 'cancelled')),
  amount numeric(12, 2) NOT NULL,
  gateway_response jsonb DEFAULT '{}'::jsonb,
  error_message text,
  gateway_transaction_id text,
  payment_method text,
  card_type text,
  gateway_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_transaction_status_user_id ON transaction_status(user_id);
CREATE INDEX IF NOT EXISTS idx_transaction_status_payment_id ON transaction_status(payment_id);
CREATE INDEX IF NOT EXISTS idx_transaction_status_reference ON transaction_status(transaction_reference);
CREATE INDEX IF NOT EXISTS idx_transaction_status_created_at ON transaction_status(created_at DESC);

-- Enable RLS
ALTER TABLE transaction_status ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own transaction status
CREATE POLICY "Users can read own transaction status"
  ON transaction_status FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Service role can insert transaction status
CREATE POLICY "Service role can insert transaction status"
  ON transaction_status FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Policy: Service role can update transaction status
CREATE POLICY "Service role can update transaction status"
  ON transaction_status FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_transaction_status_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_transaction_status_updated_at_trigger ON transaction_status;
CREATE TRIGGER update_transaction_status_updated_at_trigger
  BEFORE UPDATE ON transaction_status
  FOR EACH ROW
  EXECUTE FUNCTION update_transaction_status_updated_at();
