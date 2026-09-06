-- Drop the overly permissive policies
DROP POLICY IF EXISTS "delete_waf_ip_allowlist" ON public.waf_ip_allowlist;
DROP POLICY IF EXISTS "insert_waf_ip_allowlist" ON public.waf_ip_allowlist;
DROP POLICY IF EXISTS "update_waf_ip_allowlist" ON public.waf_ip_allowlist;
DROP POLICY IF EXISTS "select_waf_ip_allowlist" ON public.waf_ip_allowlist;

-- Restrict all write operations to super_admin users only.
-- service_role (used by edge functions) bypasses RLS entirely,
-- so the WAF function can still read the allowlist at runtime.

CREATE POLICY "select_waf_ip_allowlist" ON public.waf_ip_allowlist
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE id::text = auth.uid()::text
        AND role = 'super_admin'
        AND is_active = true
    )
  );

CREATE POLICY "insert_waf_ip_allowlist" ON public.waf_ip_allowlist
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE id::text = auth.uid()::text
        AND role = 'super_admin'
        AND is_active = true
    )
  );

CREATE POLICY "update_waf_ip_allowlist" ON public.waf_ip_allowlist
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE id::text = auth.uid()::text
        AND role = 'super_admin'
        AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE id::text = auth.uid()::text
        AND role = 'super_admin'
        AND is_active = true
    )
  );

CREATE POLICY "delete_waf_ip_allowlist" ON public.waf_ip_allowlist
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE id::text = auth.uid()::text
        AND role = 'super_admin'
        AND is_active = true
    )
  );
