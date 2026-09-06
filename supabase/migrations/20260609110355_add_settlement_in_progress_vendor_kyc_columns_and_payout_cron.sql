-- Add 'settlement_in_progress' and 'merchant_kyc_review' to payments status enum
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;

ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status = ANY (ARRAY[
    'pending',
    'processing',
    'completed',
    'failed',
    'refunded',
    'cancelled',
    'kyc_pending',
    'settlement_pending',
    'settlement_in_progress',
    'refund_pending',
    'merchant_kyc_review'
  ]));

-- Vendor KYC tracking on beneficiaries
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'beneficiaries' AND column_name = 'razorpay_vendor_kyc_doc_id'
  ) THEN
    ALTER TABLE beneficiaries ADD COLUMN razorpay_vendor_kyc_doc_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'beneficiaries' AND column_name = 'cashfree_bene_id'
  ) THEN
    ALTER TABLE beneficiaries ADD COLUMN cashfree_bene_id text;
  END IF;
END $$;

-- Index for the new cron query pattern
CREATE INDEX IF NOT EXISTS idx_payments_settlement_gateway_payout
  ON payments (status, gateway_settlement_status, updated_at)
  WHERE status IN ('settlement_pending', 'settlement_in_progress');

-- Schedule auto-payout cron every 10 minutes
SELECT cron.unschedule('auto-payout')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-payout'
);

SELECT cron.schedule(
  'auto-payout',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://vinllmoxlxgahnwpjxea.supabase.co/functions/v1/auto-payout',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpbmxsbW94bHhnYWhud3BqeGVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTI3NDAsImV4cCI6MjA5MDcyODc0MH0.2VPGaHvRtEPD2M1sXyw70k6GcEOTQ1i8G7Bk-DmtN0E"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
