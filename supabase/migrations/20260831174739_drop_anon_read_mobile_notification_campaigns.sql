-- F15: remove the always-true SELECT policy that let anonymous callers read
-- every notification campaign row, including created_by_admin_id /
-- ended_by_admin_id (administrator identifiers). The narrower
-- "read_active_campaigns" policy remains for legitimate in-app reads.
DROP POLICY IF EXISTS "anon_read_campaigns" ON public.mobile_notification_campaigns;