-- ── fn_try_claim_for_poll ─────────────────────────────────────────────────────
-- Atomically claims a stale payment for poll processing.
--
-- The key safety property: this single UPDATE statement both CHECKS and SETS
-- last_polled_at in one operation.  Two concurrent cron executions racing on
-- the same payment will serialize at PostgreSQL row level; only the first will
-- satisfy the WHERE condition and get v_updated > 0.  The second will see the
-- freshly-updated last_polled_at and return FALSE — so it skips that payment.
--
-- Parameters
--   p_payment_id        UUID of the payment to claim
--   p_min_interval_ms   Milliseconds that must have elapsed since last poll
--                       (default 240 000 = 4 minutes, matches MIN_POLL_INTERVAL_MS)
--   p_max_attempts      Ceiling on poll_count; claim rejected if already at cap
--
-- Returns TRUE if this caller successfully claimed the payment, FALSE otherwise.

CREATE OR REPLACE FUNCTION fn_try_claim_for_poll(
  p_payment_id      UUID,
  p_min_interval_ms BIGINT DEFAULT 240000,
  p_max_attempts    INT    DEFAULT 20
)
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
    poll_count     = COALESCE(poll_count, 0) + 1,
    last_polled_at = NOW()
  WHERE id         = p_payment_id
    AND status     IN ('pending', 'processing')
    AND COALESCE(poll_count, 0) < p_max_attempts
    AND (
      last_polled_at IS NULL
      OR last_polled_at < NOW() - (p_min_interval_ms || ' milliseconds')::INTERVAL
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_try_claim_for_poll(UUID, BIGINT, INT) TO service_role;
