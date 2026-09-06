/*
  # Add merchant KYC review status and ensure payout_mode exists

  1. New payment status: 'merchant_kyc_review'
     - Used when merchant submits KYC form, waiting for admin approval
     - Sits between 'kyc_pending' and 'settlement_pending'

  2. Ensure payment_gateway_settings has payout_mode column (already exists per schema,
     but guard with IF NOT EXISTS)

  3. Add 'merchant_kyc_review' to the payments status check constraint if it exists
*/

-- Add payout_mode to payment_gateway_settings if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_gateway_settings' AND column_name = 'payout_mode'
  ) THEN
    ALTER TABLE payment_gateway_settings ADD COLUMN payout_mode text DEFAULT 'manual';
  END IF;
END $$;

-- Extend payments status constraint to allow 'merchant_kyc_review'
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT tc.constraint_name INTO constraint_name
  FROM information_schema.table_constraints tc
  WHERE tc.table_name = 'payments'
    AND tc.constraint_type = 'CHECK'
    AND tc.constraint_name LIKE '%status%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE payments DROP CONSTRAINT ' || quote_ident(constraint_name);
  END IF;
END $$;

ALTER TABLE payments
  ADD CONSTRAINT payments_status_check CHECK (status IN (
    'pending',
    'processing',
    'completed',
    'failed',
    'cancelled',
    'kyc_pending',
    'merchant_kyc_review',
    'settlement_pending',
    'refund_pending',
    'refunded'
  ));

-- Extend merchant_onboarding status constraint to allow 'submitted'
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT tc.constraint_name INTO constraint_name
  FROM information_schema.table_constraints tc
  WHERE tc.table_name = 'merchant_onboarding'
    AND tc.constraint_type = 'CHECK'
    AND tc.constraint_name LIKE '%status%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE merchant_onboarding DROP CONSTRAINT ' || quote_ident(constraint_name);
  END IF;
END $$;

ALTER TABLE merchant_onboarding
  ADD CONSTRAINT merchant_onboarding_status_check CHECK (status IN (
    'pending',
    'submitted',
    'verified',
    'rejected',
    'expired',
    'refunded'
  ));
