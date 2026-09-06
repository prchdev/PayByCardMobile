-- Revoke the default PUBLIC execute grant on SECURITY DEFINER invoice functions.
-- Postgres grants EXECUTE to PUBLIC when a function is created; that covers anon/authenticated
-- via role inheritance, so revoking only from named roles is insufficient.
REVOKE EXECUTE ON FUNCTION public.get_next_invoice_number(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_invoice_number() FROM PUBLIC;
