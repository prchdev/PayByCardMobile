-- F16: create_mobile_notification is SECURITY DEFINER and inserts a notification
-- for any user id passed in, yet EXECUTE was held by anon and authenticated,
-- so anyone could push arbitrary (e.g. phishing) notifications to any customer.
-- No client code calls this RPC (verified: no reference in src/); it is invoked by
-- service-role edge functions and internal SQL only.
REVOKE EXECUTE ON FUNCTION public.create_mobile_notification(uuid, text, text, text, jsonb, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_mobile_notification(uuid, text, text, text, jsonb, uuid, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.create_mobile_notification(uuid, text, text, text, jsonb, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_mobile_notification(uuid, text, text, text, jsonb, uuid, text, text) TO service_role;