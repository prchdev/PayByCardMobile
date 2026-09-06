/*
  # Add New Payment Status Values

  ## Summary
  Extends the payments table status CHECK constraint to support granular
  user-facing transaction states that reflect the full lifecycle:

  1. **New Status Values Added**
     - `kyc_pending` — Payment gateway succeeded but beneficiary KYC is required and awaiting approval
     - `settlement_pending` — Payment succeeded and KYC is satisfied (or not required) but payout has not completed yet
     - `refund_pending` — Beneficiary KYC window expired and refund payout has not been initiated yet

  2. **Existing Values Retained**
     - `pending` — Payment not yet attempted
     - `processing` — Payment in progress at gateway
     - `completed` — Full flow done (payout completed)
     - `failed` — Gateway payment failed
     - `refunded` — Refund payout completed
     - `cancelled` — Cancelled by user before completion

  3. **Also extends payouts.status** to include `refunded` for refund payout tracking

  ## Changes
  - Drops and recreates the `status` CHECK constraint on `payments`
  - Adds `refunded` to payouts.status CHECK constraint
  - Adds `payment_id` column to payouts for payment-payout linkage
  - Adds index on payments.status for query performance
*/

-- Drop old check constraint and add new one with extended values
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
    'refund_pending'
  ]));

-- Extend payouts status to include refunded
ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payouts_status_check;

ALTER TABLE payouts ADD CONSTRAINT payouts_status_check
  CHECK (status = ANY (ARRAY[
    'pending',
    'processing',
    'completed',
    'failed',
    'reversed',
    'refunded'
  ]));

-- Add payment_id to payouts for reverse lookup (if not already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payouts' AND column_name = 'payment_id'
  ) THEN
    ALTER TABLE payouts ADD COLUMN payment_id uuid REFERENCES payments(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_payouts_payment_id ON payouts(payment_id);
  END IF;
END $$;

-- Add refund tracking columns to payouts if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payouts' AND column_name = 'refund_reason'
  ) THEN
    ALTER TABLE payouts ADD COLUMN refund_reason text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payouts' AND column_name = 'refunded_by'
  ) THEN
    ALTER TABLE payouts ADD COLUMN refunded_by uuid;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payouts' AND column_name = 'refunded_at'
  ) THEN
    ALTER TABLE payouts ADD COLUMN refunded_at timestamptz;
  END IF;
END $$;

-- Index on new status values for performance
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payouts_payment_id_status ON payouts(payment_id, status);
