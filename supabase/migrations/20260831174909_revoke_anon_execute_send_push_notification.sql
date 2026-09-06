-- F17: send_push_notification is SECURITY DEFINER and delivers a push message to
-- every active device of any user id passed in, yet EXECUTE was held by anon and
-- authenticated, so anyone could send arbitrary push content to any customer.
-- No client code calls this RPC (verified: no reference in src/).
REVOKE EXECUTE ON FUNCTION public.send_push_notification(uuid, text, text, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.send_push_notification(uuid, text, text, jsonb, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.send_push_notification(uuid, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_push_notification(uuid, text, text, jsonb, text) TO service_role;