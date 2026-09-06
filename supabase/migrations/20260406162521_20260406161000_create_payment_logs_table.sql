/*
  # Create Payment Logs Table

  1. New Tables
    - `payment_logs`
      - `id` (uuid, primary key)
      - `payment_id` (uuid, foreign key to payments)
      - `status` (text) - Log status (pending, processing, success, failed, etc.)
      - `message` (text) - Log message
      - `metadata` (jsonb) - Additional log metadata
      - `created_at` (timestamptz) - Log timestamp
      - `created_by` (uuid, optional) - User who created the log
      - `ip_address` (text) - IP address from which log was created

  2. Security
    - Enable RLS on `payment_logs` table
    - Add policy for service role to manage logs
    - Add policy for users to view their own payment logs

  3. Indexes
    - Index on payment_id for efficient lookups
    - Index on created_at for time-based queries
*/

CREATE TABLE IF NOT EXISTS payment_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  status text NOT NULL,
  message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  ip_address text
);

CREATE INDEX IF NOT EXISTS idx_payment_logs_payment_id ON payment_logs(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_logs_created_at ON payment_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_logs_status ON payment_logs(status);

ALTER TABLE payment_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage payment logs"
  ON payment_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can view their own payment logs"
  ON payment_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM payments
      WHERE payments.id = payment_logs.payment_id
      AND payments.user_id = auth.uid()
    )
  );