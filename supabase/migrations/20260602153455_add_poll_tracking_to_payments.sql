/*
  # Add poll tracking fields to payments table

  ## Purpose
  Supports the background stale-payment polling job that checks
  unresolved payments older than 10 minutes with the payment gateway.

  ## Changes
  1. `last_polled_at` (timestamptz) — timestamp of the last time this payment was
     queried against the gateway by the background poller. NULL = never polled.
  2. `poll_count` (int4, default 0) — how many times the poller has attempted to
     check this payment. Used to cap retries (max 20 polls ≈ ~3.5 hours).

  ## Notes
  - No data is lost; both columns are nullable / have defaults.
  - No RLS changes needed; these are internal tracking fields written by
    the service-role edge function only.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'last_polled_at'
  ) THEN
    ALTER TABLE payments ADD COLUMN last_polled_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'poll_count'
  ) THEN
    ALTER TABLE payments ADD COLUMN poll_count integer NOT NULL DEFAULT 0;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payments_stale_poll
  ON payments (status, created_at, last_polled_at)
  WHERE status IN ('pending', 'processing');
