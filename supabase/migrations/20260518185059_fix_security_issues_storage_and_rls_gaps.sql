-- Fix security issues: storage listing and RLS policy gaps
--
-- 1. kyc-documents bucket: drop broad anon SELECT policy, replace with
--    authenticated-only policy scoped to the user's own UID folder.
-- 2. user_password_reset_otps: add explicit deny policies (service-role only table).
-- 3. waf_threat_logs: add explicit deny policies (service-role only table).

-- ================================================================
-- 1. kyc-documents storage SELECT policy
-- ================================================================

DROP POLICY IF EXISTS "Allow kyc document reads" ON storage.objects;

CREATE POLICY "Authenticated users can read own kyc files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'kyc-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[1] = 'master-settings'
    )
  );

-- ================================================================
-- 2. user_password_reset_otps - service-role-only (deny authenticated)
-- ================================================================

CREATE POLICY "No select on user_password_reset_otps"
  ON user_password_reset_otps FOR SELECT
  TO authenticated
  USING (false);

CREATE POLICY "No insert on user_password_reset_otps"
  ON user_password_reset_otps FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "No update on user_password_reset_otps"
  ON user_password_reset_otps FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "No delete on user_password_reset_otps"
  ON user_password_reset_otps FOR DELETE
  TO authenticated
  USING (false);

-- ================================================================
-- 3. waf_threat_logs - service-role-only (deny authenticated)
-- ================================================================

CREATE POLICY "No select on waf_threat_logs"
  ON waf_threat_logs FOR SELECT
  TO authenticated
  USING (false);

CREATE POLICY "No insert on waf_threat_logs"
  ON waf_threat_logs FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "No update on waf_threat_logs"
  ON waf_threat_logs FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "No delete on waf_threat_logs"
  ON waf_threat_logs FOR DELETE
  TO authenticated
  USING (false);
