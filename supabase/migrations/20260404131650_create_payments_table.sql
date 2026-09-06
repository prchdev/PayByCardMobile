/*
  # Create payments and payment logs tables

  1. New Tables
    - `payments`
      - `id` (uuid, primary key) - Unique identifier
      - `user_id` (uuid, foreign key) - Reference to users table
      - `beneficiary_id` (uuid, foreign key) - Reference to beneficiaries table
      - `payment_category_id` (uuid, foreign key) - Reference to payment_categories table
      - `payment_gateway_id` (uuid, foreign key) - Reference to payment_gateway_settings table
      - `amount` (numeric) - Payment amount
      - `charges` (numeric) - Platform charges
      - `gst` (numeric) - GST on charges
      - `discount` (numeric) - Discount applied
      - `total_amount` (numeric) - Total amount (amount + charges + gst - discount)
      - `payment_reference` (text) - Unique payment reference number
      - `bill_file_url` (text) - Optional bill upload URL
      - `status` (text) - Payment status (pending, processing, completed, failed, refunded)
      - `gateway_transaction_id` (text) - Gateway transaction reference
      - `gateway_response` (jsonb) - Gateway response data
      - `ip_address` (text) - IP address of user
      - `created_at` (timestamptz) - Record creation timestamp
      - `updated_at` (timestamptz) - Last update timestamp
      - `completed_at` (timestamptz) - Payment completion timestamp

    - `payment_logs`
      - `id` (uuid, primary key) - Unique identifier
      - `payment_id` (uuid, foreign key) - Reference to payments table
      - `status` (text) - Log status
      - `message` (text) - Log message
      - `metadata` (jsonb) - Additional metadata
      - `created_at` (timestamptz) - Log creation timestamp

  2. Security
    - Enable RLS on both tables
    - Add policies for authenticated users to manage their own payments
    - Add policies for viewing payment logs

  3. Important Notes
    - Payment reference will be auto-generated with format: PAY-YYYYMMDD-XXXXXX
    - All amounts are stored in numeric format with 2 decimal precision
    - Status transitions are logged in payment_logs table
*/

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  beneficiary_id uuid NOT NULL REFERENCES beneficiaries(id) ON DELETE RESTRICT,
  payment_category_id uuid NOT NULL REFERENCES payment_categories(id) ON DELETE RESTRICT,
  payment_gateway_id uuid REFERENCES payment_gateway_settings(id) ON DELETE RESTRICT,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  charges numeric(15,2) NOT NULL DEFAULT 0,
  gst numeric(15,2) NOT NULL DEFAULT 0,
  discount numeric(15,2) NOT NULL DEFAULT 0,
  total_amount numeric(15,2) NOT NULL CHECK (total_amount > 0),
  payment_reference text UNIQUE NOT NULL,
  bill_file_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded', 'cancelled')),
  gateway_transaction_id text,
  gateway_response jsonb,
  ip_address text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS payment_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  status text NOT NULL,
  message text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own payments"
  ON payments
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own payments"
  ON payments
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own payments"
  ON payments
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own payment logs"
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

CREATE POLICY "Authenticated users can insert payment logs"
  ON payment_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments(payment_reference);
CREATE INDEX IF NOT EXISTS idx_payment_logs_payment_id ON payment_logs(payment_id);

CREATE OR REPLACE FUNCTION update_payments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_payments_timestamp
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_payments_updated_at();

CREATE OR REPLACE FUNCTION generate_payment_reference()
RETURNS text AS $$
DECLARE
  ref_number text;
  ref_exists boolean;
BEGIN
  LOOP
    ref_number := 'PAY-' || to_char(now(), 'YYYYMMDD') || '-' || 
                  lpad(floor(random() * 1000000)::text, 6, '0');
    
    SELECT EXISTS(SELECT 1 FROM payments WHERE payment_reference = ref_number) INTO ref_exists;
    
    EXIT WHEN NOT ref_exists;
  END LOOP;
  
  RETURN ref_number;
END;
$$ LANGUAGE plpgsql;
