
CREATE TABLE IF NOT EXISTS refund_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  payout_id uuid REFERENCES payouts(id) ON DELETE SET NULL,
  admin_id uuid NOT NULL,
  gateway_id uuid REFERENCES payment_gateway_settings(id) ON DELETE SET NULL,
  gateway_name text,
  refund_reference text UNIQUE NOT NULL,
  gateway_refund_id text,
  gateway_response jsonb,
  amount numeric(15,2) NOT NULL,
  -- 'processed' = gateway API called and succeeded
  -- 'pending'   = gateway accepted but async processing
  -- 'failed'    = gateway API returned failure
  -- 'skipped'   = no gateway txn ID, DB-only refund
  status text NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated', 'pending', 'processed', 'failed', 'skipped')),
  -- 'gateway' = called gateway refund API
  -- 'manual'  = manual refund logged by admin without gateway call
  -- 'db_only' = no gateway transaction existed; DB status updated only
  refund_type text NOT NULL DEFAULT 'gateway'
    CHECK (refund_type IN ('gateway', 'manual', 'db_only')),
  payout_mode text,
  gateway_settlement_status text,
  failure_reason text,
  initiated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE refund_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_refund_transactions" ON refund_transactions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_refund_transactions_payment_id ON refund_transactions(payment_id);
CREATE INDEX idx_refund_transactions_admin_id ON refund_transactions(admin_id);
CREATE INDEX idx_refund_transactions_status ON refund_transactions(status);
CREATE INDEX idx_refund_transactions_created_at ON refund_transactions(created_at DESC);
