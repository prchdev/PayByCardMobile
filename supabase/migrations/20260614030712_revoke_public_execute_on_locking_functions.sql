-- Revoke default PUBLIC execute privilege from all pessimistic locking functions.
-- PostgreSQL grants EXECUTE to PUBLIC by default; this removes anon + authenticated access.
-- Only service_role (used by edge functions via SUPABASE_SERVICE_ROLE_KEY) may call these.

REVOKE EXECUTE ON FUNCTION public.fn_check_recent_duplicate_payment(uuid, uuid, numeric, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_release_payment_lock(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_try_claim_for_payout(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_try_claim_for_poll(uuid, bigint, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_try_claim_for_refund(uuid) FROM PUBLIC;