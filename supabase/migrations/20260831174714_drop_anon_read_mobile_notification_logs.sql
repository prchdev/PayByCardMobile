-- F14: remove the always-true SELECT policy that let anonymous callers read
-- every notification delivery log row, including every customer's user_id.
-- The narrower "select_own_logs" policy remains for per-user reads, and the
-- service role (used by all edge functions) is unaffected by RLS.
DROP POLICY IF EXISTS "anon_read_logs" ON public.mobile_notification_logs;