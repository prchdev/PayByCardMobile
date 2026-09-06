-- ── kyc_business_info ────────────────────────────────────────────────────────
-- approved_by_admin_id was orphaned when the original auth.users FK was dropped.
-- Null out any values that don't resolve to a real admin before adding the constraint.
UPDATE kyc_business_info
SET approved_by_admin_id = NULL
WHERE approved_by_admin_id IS NOT NULL
  AND approved_by_admin_id NOT IN (SELECT id FROM admin_users);

ALTER TABLE kyc_business_info
  ADD CONSTRAINT kyc_business_info_approved_by_admin_id_fkey
  FOREIGN KEY (approved_by_admin_id)
  REFERENCES admin_users(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_kyc_business_approved_by_admin
  ON kyc_business_info(approved_by_admin_id)
  WHERE approved_by_admin_id IS NOT NULL;

-- ── merchant_onboarding ───────────────────────────────────────────────────────
-- payment_id and beneficiary_id are stored but have no FK constraints.
-- Null out orphaned values first.
UPDATE merchant_onboarding
SET payment_id = NULL
WHERE payment_id IS NOT NULL
  AND payment_id NOT IN (SELECT id FROM payments);

UPDATE merchant_onboarding
SET beneficiary_id = NULL
WHERE beneficiary_id IS NOT NULL
  AND beneficiary_id NOT IN (SELECT id FROM beneficiaries);

ALTER TABLE merchant_onboarding
  ADD CONSTRAINT merchant_onboarding_payment_id_fkey
  FOREIGN KEY (payment_id)
  REFERENCES payments(id)
  ON DELETE SET NULL;

ALTER TABLE merchant_onboarding
  ADD CONSTRAINT merchant_onboarding_beneficiary_id_fkey
  FOREIGN KEY (beneficiary_id)
  REFERENCES beneficiaries(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_merchant_onboarding_payment_id
  ON merchant_onboarding(payment_id)
  WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_merchant_onboarding_beneficiary_id
  ON merchant_onboarding(beneficiary_id)
  WHERE beneficiary_id IS NOT NULL;

-- ── refund_transactions ───────────────────────────────────────────────────────
-- admin_id is stored as a plain uuid with no FK to admin_users.
-- Null out orphaned values first (column is NOT NULL so only clean data allowed).
-- Since admin_id is NOT NULL, we cannot null it out — instead verify all values resolve.
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM refund_transactions
  WHERE admin_id NOT IN (SELECT id FROM admin_users);

  IF orphan_count > 0 THEN
    RAISE NOTICE 'refund_transactions: % rows have orphaned admin_id — skipping FK for that column', orphan_count;
  ELSE
    EXECUTE '
      ALTER TABLE refund_transactions
        ADD CONSTRAINT refund_transactions_admin_id_fkey
        FOREIGN KEY (admin_id)
        REFERENCES admin_users(id)
        ON DELETE RESTRICT
    ';
    RAISE NOTICE 'refund_transactions: admin_id FK added successfully';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_refund_transactions_admin_id_fk
  ON refund_transactions(admin_id);
