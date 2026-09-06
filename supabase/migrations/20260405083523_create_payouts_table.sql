/*
  # Create payouts and payout logs tables

  1. New Tables
    - `payouts`
      - `id` (uuid, primary key) - Unique identifier
      - `user_id` (uuid, foreign key) - Reference to users table
      - `beneficiary_id` (uuid, foreign key) - Reference to beneficiaries table
      - `payment_gateway_id` (uuid, foreign key) - Reference to payment_gateway_settings table
      - `amount` (numeric) - Payout amount
      - `charges` (numeric) - Platform charges
      - `gst` (numeric) - GST on charges
      - `total_deduction` (numeric) - Total deduction (charges + gst)
      - `net_amount` (numeric) - Net amount to be transferred
      - `payout_reference` (text) - Unique payout reference number
      - `transfer_type` (text) - Transfer type (IMPS, NEFT, RTGS)
      - `account_number` (text) - Beneficiary account number
      - `ifsc_code` (text) - Bank IFSC code
      - `account_holder_name` (text) - Account holder name
      - `bank_name` (text) - Bank name
      - `status` (text) - Payout status (pending, processing, completed, failed, reversed)
      - `gateway_transaction_id` (text) - Gateway transaction reference
      - `utr_number` (text) - Unique Transaction Reference number
      - `gateway_request` (jsonb) - Gateway request payload
      - `gateway_response` (jsonb) - Gateway response data
      - `gateway_status_code` (text) - Gateway status code
      - `gateway_environment` (text) - Environment (test/production)
      - `failure_reason` (text) - Reason for payout failure
      - `ip_address` (text) - IP address of user
      - `created_at` (timestamptz) - Record creation timestamp
      - `updated_at` (timestamptz) - Last update timestamp
      - `completed_at` (timestamptz) - Payout completion timestamp

    - `payout_logs`
      - `id` (uuid, primary key) - Unique identifier
      - `payout_id` (uuid, foreign key) - Reference to payouts table
      - `status` (text) - Log status
      - `message` (text) - Log message
      - `metadata` (jsonb) - Additional metadata
      - `created_at` (timestamptz) - Log creation timestamp

  2. Security
    - Enable RLS on both tables
    - Add policies for authenticated users to manage their own payouts
    - Add policies for viewing payout logs

  3. Important Notes
    - Payout reference will be auto-generated with format: PAYOUT-YYYYMMDD-XXXXXX
    - All amounts are stored in numeric format with 2 decimal precision
    - Status transitions are logged in payout_logs table
    - Account details are stored for audit purposes
*/

CREATE TABLE IF NOT EXISTS payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  beneficiary_id uuid NOT NULL REFERENCES beneficiaries(id) ON DELETE RESTRICT,
  payment_gateway_id uuid REFERENCES payment_gateway_settings(id) ON DELETE RESTRICT,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  charges numeric(15,2) NOT NULL DEFAULT 0,
  gst numeric(15,2) NOT NULL DEFAULT 0,
  total_deduction numeric(15,2) NOT NULL DEFAULT 0,
  net_amount numeric(15,2) NOT NULL CHECK (net_amount > 0),
  payout_reference text UNIQUE NOT NULL,
  transfer_type text NOT NULL CHECK (transfer_type IN ('IMPS', 'NEFT', 'RTGS')),
  account_number text NOT NULL,
  ifsc_code text NOT NULL,
  account_holder_name text NOT NULL,
  bank_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'reversed')),
  gateway_transaction_id text,
  utr_number text,
  gateway_request jsonb,
  gateway_response jsonb,
  gateway_status_code text,
  gateway_environment text DEFAULT 'production' CHECK (gateway_environment IN ('test', 'production')),
  failure_reason text,
  ip_address text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS payout_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id uuid NOT NULL REFERENCES payouts(id) ON DELETE CASCADE,
  status text NOT NULL,
  message text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own payouts"
  ON payouts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own payouts"
  ON payouts
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own payouts"
  ON payouts
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own payout logs"
  ON payout_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM payouts
      WHERE payouts.id = payout_logs.payout_id
      AND payouts.user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can insert payout logs"
  ON payout_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_payouts_user_id ON payouts(user_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
CREATE INDEX IF NOT EXISTS idx_payouts_reference ON payouts(payout_reference);
CREATE INDEX IF NOT EXISTS idx_payouts_utr ON payouts(utr_number);
CREATE INDEX IF NOT EXISTS idx_payout_logs_payout_id ON payout_logs(payout_id);

CREATE OR REPLACE FUNCTION update_payouts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_payouts_timestamp
  BEFORE UPDATE ON payouts
  FOR EACH ROW
  EXECUTE FUNCTION update_payouts_updated_at();

CREATE OR REPLACE FUNCTION generate_payout_reference()
RETURNS text AS $$
DECLARE
  ref_number text;
  ref_exists boolean;
BEGIN
  LOOP
    ref_number := 'PAYOUT-' || to_char(now(), 'YYYYMMDD') || '-' || 
                  lpad(floor(random() * 1000000)::text, 6, '0');
    
    SELECT EXISTS(SELECT 1 FROM payouts WHERE payout_reference = ref_number) INTO ref_exists;
    
    EXIT WHEN NOT ref_exists;
  END LOOP;
  
  RETURN ref_number;
END;
$$ LANGUAGE plpgsql;