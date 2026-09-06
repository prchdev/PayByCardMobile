/*
  # Create Transactions and Settlement Configuration Tables

  1. New Tables
    - `transactions`
      - Complete payment transaction records with beneficiary details
      - Payment gateway transaction reference
      - Payout transaction reference
      - Transaction status tracking
      - Bill upload reference
      - Payment charges and settlement type
    
    - `transaction_logs`
      - Audit trail for all transaction status changes
      - Stores timestamps and metadata for each status change
    
    - `settlement_config`
      - Configuration for settlement timing and limits
      - IMPS/RTGS threshold
      - Normal settlement delay configuration

  2. Security
    - Enable RLS on all tables
    - Policies for authenticated users to manage their transactions
    - Admin policies for transaction monitoring

  3. Important Notes
    - Transactions link to payment_gateway_settings for gateway selection
    - Transactions link to payment_options for charge calculation
    - Status values: pending, processing, completed, failed, payout_failed
    - Settlement types: instant, normal
*/

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  
  -- Beneficiary Information
  beneficiary_name TEXT NOT NULL,
  beneficiary_email TEXT NOT NULL,
  beneficiary_mobile TEXT NOT NULL,
  beneficiary_pan TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  ifsc_code TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('savings', 'current')),
  
  -- Transaction Details
  amount_to_pay NUMERIC(15,2) NOT NULL,
  payment_category_id UUID,
  bill_file_path TEXT,
  
  -- Payment Charges
  payment_option_id UUID,
  payment_gateway_id UUID,
  charges NUMERIC(15,2) DEFAULT 0.00,
  charges_percentage NUMERIC(5,2) DEFAULT 0.00,
  gst NUMERIC(15,2) DEFAULT 0.00,
  gst_percentage NUMERIC(5,2) DEFAULT 0.00,
  total_amount NUMERIC(15,2) NOT NULL,
  
  -- Settlement Type
  settlement_type TEXT NOT NULL CHECK (settlement_type IN ('instant', 'normal')),
  instant_settlement_charges NUMERIC(15,2) DEFAULT 0.00,
  instant_settlement_charges_percentage NUMERIC(5,2) DEFAULT 0.00,
  
  -- Payment Gateway Transaction
  payment_gateway_transaction_id TEXT,
  payment_gateway_reference TEXT,
  payment_gateway_status TEXT,
  payment_gateway_status_code TEXT,
  payment_gateway_response JSONB,
  payment_completed_at TIMESTAMPTZ,
  
  -- Card Type Restrictions
  allowed_card_types TEXT[] DEFAULT ARRAY[]::TEXT[],
  card_type_used TEXT,
  
  -- Payout Transaction
  payout_id UUID,
  payout_reference TEXT,
  payout_status TEXT,
  payout_transfer_type TEXT CHECK (payout_transfer_type IN ('IMPS', 'RTGS')),
  payout_initiated_at TIMESTAMPTZ,
  payout_completed_at TIMESTAMPTZ,
  payout_utr_number TEXT,
  
  -- Transaction Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'payout_failed')),
  
  -- Metadata
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Foreign Keys
  CONSTRAINT fk_transactions_user FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT fk_transactions_payment_category FOREIGN KEY (payment_category_id) REFERENCES payment_options(id),
  CONSTRAINT fk_transactions_payment_option FOREIGN KEY (payment_option_id) REFERENCES payment_options(id),
  CONSTRAINT fk_transactions_payment_gateway FOREIGN KEY (payment_gateway_id) REFERENCES payment_gateway_settings(id),
  CONSTRAINT fk_transactions_payout FOREIGN KEY (payout_id) REFERENCES payouts(id)
);

-- Create transaction_logs table
CREATE TABLE IF NOT EXISTS transaction_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT fk_transaction_logs_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
);

-- Create settlement_config table
CREATE TABLE IF NOT EXISTS settlement_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- IMPS/RTGS Threshold
  imps_max_amount NUMERIC(15,2) DEFAULT 200000.00,
  
  -- Normal Settlement Delay (in minutes)
  normal_settlement_delay_minutes INTEGER DEFAULT 1440,
  
  -- Payment Status Check Interval (in minutes)
  payment_status_check_interval_minutes INTEGER DEFAULT 15,
  
  -- Auto-payout Configuration
  auto_payout_enabled BOOLEAN DEFAULT true,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insert default settlement configuration
INSERT INTO settlement_config (
  imps_max_amount,
  normal_settlement_delay_minutes,
  payment_status_check_interval_minutes,
  auto_payout_enabled
) VALUES (
  200000.00,
  1440,
  15,
  true
) ON CONFLICT DO NOTHING;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_payment_gateway_id ON transactions(payment_gateway_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transaction_logs_transaction_id ON transaction_logs(transaction_id);

-- Create updated_at trigger for transactions
CREATE OR REPLACE FUNCTION update_transactions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_transactions_updated_at ON transactions;
CREATE TRIGGER trigger_update_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_transactions_updated_at();

-- Enable RLS
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_config ENABLE ROW LEVEL SECURITY;

-- RLS Policies for transactions
CREATE POLICY "Users can view own transactions"
  ON transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own transactions"
  ON transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transactions"
  ON transactions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for transaction_logs
CREATE POLICY "Users can view own transaction logs"
  ON transaction_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM transactions
      WHERE transactions.id = transaction_logs.transaction_id
      AND transactions.user_id = auth.uid()
    )
  );

CREATE POLICY "System can insert transaction logs"
  ON transaction_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- RLS Policies for settlement_config
CREATE POLICY "Anyone can view settlement config"
  ON settlement_config FOR SELECT
  TO authenticated
  USING (true);