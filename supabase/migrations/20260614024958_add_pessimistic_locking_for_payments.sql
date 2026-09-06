-- ── Pessimistic locking for financial transaction processing ─────────────────
-- 
-- payout_locked_at: timestamp when a process last acquired a row-level lock.
-- A non-NULL value that is < 10 minutes old means the row is "claimed".
-- Stale locks (> 10 min) are automatically eligible for re-claim.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS payout_locked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payments_payout_locked_at
  ON payments(payout_locked_at)
  WHERE payout_locked_at IS NOT NULL;

-- ── fn_try_claim_for_payout ───────────────────────────────────────────────────
-- Atomically claims a payment for payout processing.
--   • settlement_pending  → transitions to settlement_in_progress and acquires lock
--   • settlement_in_progress (expired lock) → re-acquires lock
-- Returns TRUE if this caller now owns the lock, FALSE if another process holds it.
CREATE OR REPLACE FUNCTION fn_try_claim_for_payout(p_payment_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT;
BEGIN
  -- Case 1: settlement_pending → advance status and set lock
  UPDATE payments
  SET
    status           = 'settlement_in_progress',
    payout_locked_at = NOW(),
    updated_at       = NOW()
  WHERE id     = p_payment_id
    AND status = 'settlement_pending'
    AND (payout_locked_at IS NULL OR payout_locked_at < NOW() - INTERVAL '10 minutes');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated > 0 THEN RETURN TRUE; END IF;

  -- Case 2: already settlement_in_progress with expired/no lock → re-acquire
  UPDATE payments
  SET
    payout_locked_at = NOW(),
    updated_at       = NOW()
  WHERE id     = p_payment_id
    AND status = 'settlement_in_progress'
    AND (payout_locked_at IS NULL OR payout_locked_at < NOW() - INTERVAL '10 minutes');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

-- ── fn_try_claim_for_refund ───────────────────────────────────────────────────
-- Atomically claims a payment for refund processing.
-- Prevents concurrent payout + refund on the same payment.
-- Returns TRUE if lock acquired, FALSE if another operation holds it.
CREATE OR REPLACE FUNCTION fn_try_claim_for_refund(p_payment_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE payments
  SET
    payout_locked_at = NOW(),
    updated_at       = NOW()
  WHERE id     = p_payment_id
    AND status NOT IN ('refunded', 'cancelled', 'failed')
    AND (payout_locked_at IS NULL OR payout_locked_at < NOW() - INTERVAL '5 minutes');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

-- ── fn_release_payment_lock ───────────────────────────────────────────────────
-- Explicitly releases a payment lock after processing completes or fails.
CREATE OR REPLACE FUNCTION fn_release_payment_lock(p_payment_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE payments
  SET payout_locked_at = NULL, updated_at = NOW()
  WHERE id = p_payment_id;
END;
$$;

-- ── fn_check_recent_duplicate_payment ────────────────────────────────────────
-- Detects duplicate payment submissions: same user + beneficiary + amount
-- within the last N seconds. Used to prevent double-submit on network retry.
CREATE OR REPLACE FUNCTION fn_check_recent_duplicate_payment(
  p_user_id       UUID,
  p_beneficiary_id UUID,
  p_amount        NUMERIC,
  p_window_secs   INT DEFAULT 30
)
RETURNS BOOLEAN   -- TRUE = duplicate exists, do not proceed
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM payments
  WHERE user_id        = p_user_id
    AND beneficiary_id = p_beneficiary_id
    AND amount         = p_amount
    AND created_at     > NOW() - (p_window_secs || ' seconds')::INTERVAL
    AND status NOT IN ('failed', 'refunded', 'cancelled');

  RETURN v_count > 0;
END;
$$;

-- ── Grant execute rights to service role and anon (called via edge functions) ─
GRANT EXECUTE ON FUNCTION fn_try_claim_for_payout(UUID)                                  TO service_role;
GRANT EXECUTE ON FUNCTION fn_try_claim_for_refund(UUID)                                  TO service_role;
GRANT EXECUTE ON FUNCTION fn_release_payment_lock(UUID)                                  TO service_role;
GRANT EXECUTE ON FUNCTION fn_check_recent_duplicate_payment(UUID, UUID, NUMERIC, INT)    TO service_role;
