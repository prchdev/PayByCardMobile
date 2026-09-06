-- F8: the policy named "Admins can read kyc_method_settings" had the predicate
-- `true` for role `authenticated`, so any principal holding an authenticated JWT
-- could read the KYC provider API keys, API secrets and key passwords stored in
-- this table. No client code reads this table directly (verified: no reference in
-- src/), only service-role edge functions do, and the service role bypasses RLS.
DROP POLICY IF EXISTS "Admins can read kyc_method_settings" ON public.kyc_method_settings;

CREATE POLICY "Service role can read kyc_method_settings"
  ON public.kyc_method_settings
  FOR SELECT
  TO service_role
  USING (true);